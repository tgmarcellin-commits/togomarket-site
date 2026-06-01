import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  AdminStorageCleanupBody,
  AdminStorageCleanupResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { db, listingsTable, adsTable } from "@workspace/db";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // --- Protected route example (uncomment when using replit-auth) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * POST /admin/storage/cleanup
 *
 * Find and delete orphan files in Object Storage (files not referenced by any listing or ad).
 */
router.post("/admin/storage/cleanup", async (req: Request, res: Response) => {
  const parsed = AdminStorageCleanupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Champs invalides" });
    return;
  }
  if (parsed.data.password !== ADMIN_PASSWORD) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const allPaths = await objectStorageService.listAllObjectEntityPaths();

    const [listings, ads] = await Promise.all([
      db.select({ images: listingsTable.images }).from(listingsTable),
      db.select({ image: adsTable.image, videoPath: adsTable.videoPath }).from(adsTable),
    ]);

    const usedPaths = new Set<string>();
    for (const l of listings) {
      for (const img of l.images ?? []) {
        if (img.startsWith("/objects/")) usedPaths.add(img);
      }
    }
    for (const a of ads) {
      if (a.image?.startsWith("/objects/")) usedPaths.add(a.image);
      if (a.videoPath?.startsWith("/objects/")) usedPaths.add(a.videoPath);
    }

    const orphans = allPaths.filter((p) => !usedPaths.has(p));
    await Promise.allSettled(orphans.map((p) => objectStorageService.deleteObjectEntity(p)));

    req.log.info({ deleted: orphans.length }, "Storage cleanup completed");
    res.json(AdminStorageCleanupResponse.parse({ deleted: orphans.length }));
  } catch (error) {
    req.log.error({ err: error }, "Storage cleanup failed");
    res.status(500).json({ error: "Cleanup failed" });
  }
});

export default router;
