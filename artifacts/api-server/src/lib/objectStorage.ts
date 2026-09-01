import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  adsTable,
  db,
  eventsTable,
  listingsTable,
  messagesTable,
  servicesTable,
  vendorsTable,
} from "@workspace/db";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const CONVERSATION_CLEANUP_METADATA_KEY = "conversationCleanupCandidate";

/**
 * Return the persisted object path without the presentation-only video marker.
 * Non-object values (legacy data URLs, empty values, etc.) are not storage
 * references and must never be sent to the object storage API.
 */
export function normalizeObjectStoragePath(
  value: string | null | undefined,
): string | null {
  const normalized = value?.startsWith("v:") ? value.slice(2) : value;
  if (!normalized?.startsWith("/objects/") || normalized === "/objects/") {
    return null;
  }
  return normalized;
}

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async signObjectEntityReadURL(objectPath: string, ttlSec: number = 3600): Promise<string> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const fullPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({ bucketName, objectName, method: "GET", ttlSec });
  }

  private async getReferencedObjectPaths(): Promise<Set<string>> {
    const [listings, ads, vendors, messages, services, events] = await Promise.all([
      db.select({ images: listingsTable.images }).from(listingsTable),
      db.select({ image: adsTable.image, videoPath: adsTable.videoPath }).from(adsTable),
      db.select({ profilePhoto: vendorsTable.profilePhoto }).from(vendorsTable),
      db.select({ fileUrl: messagesTable.fileUrl }).from(messagesTable),
      db.select({ image: servicesTable.image, videoPath: servicesTable.videoPath }).from(servicesTable),
      db.select({ flyerImage: eventsTable.flyerImage, videoPath: eventsTable.videoPath }).from(eventsTable),
    ]);
    const paths = new Set<string>();
    const add = (value: string | null | undefined) => {
      const normalized = normalizeObjectStoragePath(value);
      if (normalized) paths.add(normalized);
    };

    for (const listing of listings) {
      for (const image of listing.images ?? []) add(image);
    }
    for (const ad of ads) {
      add(ad.image);
      add(ad.videoPath);
    }
    for (const vendor of vendors) add(vendor.profilePhoto);
    for (const message of messages) add(message.fileUrl);
    for (const service of services) {
      add(service.image);
      add(service.videoPath);
    }
    for (const event of events) {
      add(event.flyerImage);
      add(event.videoPath);
    }
    return paths;
  }

  private async deleteObjectEntityUnchecked(objectPath: string): Promise<void> {
    const file = await this.getObjectEntityFile(objectPath);
    await file.delete();
  }

  async deleteObjectEntity(objectPath: string): Promise<void> {
    const normalizedPath = normalizeObjectStoragePath(objectPath);
    if (!normalizedPath) return;

    // This is the final safety net for every deletion caller, including
    // legacy routes that may not have their own reference check.
    const referencedPaths = await this.getReferencedObjectPaths();
    if (referencedPaths.has(normalizedPath)) return;

    try {
      await this.deleteObjectEntityUnchecked(normalizedPath);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return;
      throw err;
    }
  }

  async deleteObjectEntities(objectPaths: string[]): Promise<{ failed: string[] }> {
    const storagePaths = Array.from(new Set(
      objectPaths.flatMap((path) => {
        const normalized = normalizeObjectStoragePath(path);
        return normalized ? [normalized] : [];
      }),
    ));
    if (storagePaths.length === 0) return { failed: [] };

    const referencedPaths = await this.getReferencedObjectPaths();
    const deletablePaths = storagePaths.filter((p) => !referencedPaths.has(p));
    const results = await Promise.allSettled(
      deletablePaths.map((p) => this.deleteObjectEntityUnchecked(p)),
    );
    return {
      failed: results.flatMap((result, index) =>
        result.status === "rejected" ? [deletablePaths[index]] : []
      ),
    };
  }

  async markObjectEntityForConversationCleanup(objectPath: string): Promise<void> {
    const file = await this.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    await file.setMetadata({
      metadata: {
        ...metadata.metadata,
        [CONVERSATION_CLEANUP_METADATA_KEY]: "true",
      },
    });
  }

  async uploadObjectEntity(
    buffer: Buffer,
    contentType: string,
    aclPolicy?: ObjectAclPolicy,
  ): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType, resumable: false });
    if (aclPolicy) await setObjectAclPolicy(file, aclPolicy);
    return `/objects/uploads/${objectId}`;
  }

  async listAllObjectEntityPaths(): Promise<string[]> {
    const privateObjectDir = this.getPrivateObjectDir();
    const { bucketName, objectName } = parseObjectPath(privateObjectDir + "/");
    const prefix = objectName.endsWith("/") ? objectName : objectName + "/";
    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix });
    return files
      .map((file) => objectNameToEntityPath(file.name, prefix))
      .filter((path): path is string => path !== null);
  }

  async listConversationCleanupCandidatePathsOlderThan(
    cutoff: Date,
  ): Promise<string[]> {
    const privateObjectDir = this.getPrivateObjectDir();
    const { bucketName, objectName } = parseObjectPath(privateObjectDir + "/");
    const prefix = objectName.endsWith("/") ? objectName : objectName + "/";
    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix });

    return files.flatMap((file) => {
      const cleanupCandidate =
        file.metadata.metadata?.[CONVERSATION_CLEANUP_METADATA_KEY] === "true";
      const rawAclPolicy = file.metadata.metadata?.["custom:aclPolicy"];
      let conversationOwned = false;
      try {
        const owner = rawAclPolicy
          ? (JSON.parse(String(rawAclPolicy)) as { owner?: unknown }).owner
          : undefined;
        conversationOwned =
          typeof owner === "string" && owner.startsWith("conversation:");
      } catch {
        conversationOwned = false;
      }
      if (!cleanupCandidate && !conversationOwned) {
        return [];
      }

      const rawCreatedAt = file.metadata.timeCreated ?? file.metadata.updated;
      const createdAt = rawCreatedAt
        ? new Date(String(rawCreatedAt)).getTime()
        : Number.NaN;
      if (!Number.isFinite(createdAt) || createdAt >= cutoff.getTime()) {
        return [];
      }
      const path = objectNameToEntityPath(file.name, prefix);
      return path ? [path] : [];
    });
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

export function objectNameToEntityPath(fileName: string, prefix: string): string | null {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (!fileName.startsWith(normalizedPrefix)) {
    return null;
  }

  const entityName = fileName.slice(normalizedPrefix.length).replace(/^\/+/, "");
  return entityName ? `/objects/${entityName}` : null;
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const data = await response.json() as { signed_url: string };
  const signedURL = data.signed_url;
  return signedURL;
}
