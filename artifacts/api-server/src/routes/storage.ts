import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { Readable } from "stream";
import { spawn } from "child_process";
import { createReadStream, statSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { unlink } from "fs/promises";
import multer from "multer";
import {
  AdminStorageCleanupBody,
  AdminStorageCleanupResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { uploadCloudinaryImage, deleteCloudinaryImage, parseCloudinaryImageUrl } from "../lib/cloudinary-image";
import {
  db,
  listingsTable,
  adsTable,
  eventsTable,
  messagesTable,
  servicesTable,
  vendorsTable,
} from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import { isAdminAny, isSuperAdmin } from "../lib/admin-auth";
import { validateFileBytes } from "../lib/file-security";
import { getObjectAclPolicy } from "../lib/objectAcl";
import { collectReferencedObjectPaths } from "../lib/storageCleanup";
import { authenticateVendorRequest } from "../lib/vendor-auth";
import { normalizePhone, phoneEq } from "../lib/phone";

const videoUpload = multer({
  dest: "/tmp",
  limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 2 },
});
const imageUpload = multer({
  dest: "/tmp",
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2 },
});
let activeVideoJobs = 0;
const generatedVideoPosterCache = new Map<string, string>();
const videoPosterJobs = new Map<string, Promise<string>>();

/** Run ffmpeg to compress a video file. Returns path to compressed output. */
function compressVideo(inputPath: string, outputPath: string): Promise<{ originalSize: number; compressedSize: number }> {
  return new Promise((resolve, reject) => {
    const originalSize = statSync(inputPath).size;

    const args = [
      "-y",
      "-i", inputPath,
      "-t", "300",
      "-vf", "scale=-2:min(720\\,ih)",
      "-c:v", "libx264",
      "-crf", "26",
      "-preset", "fast",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-threads", "2",
      outputPath,
    ];

    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    const timeout = setTimeout(() => ffmpeg.kill("SIGKILL"), 120_000);

    let stderr = "";
    ffmpeg.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    ffmpeg.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-300)}`));
        return;
      }
      try {
        const compressedSize = statSync(outputPath).size;
        resolve({ originalSize, compressedSize });
      } catch {
        reject(new Error("Compressed file not found after ffmpeg"));
      }
    });

    ffmpeg.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Pick a representative frame from the first ten seconds instead of blindly
 * using timestamp zero, which is often a black fade-in for advertising videos.
 */
function extractVideoPreviewFrame(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-t", "10",
      "-vf", "thumbnail=300,scale=-2:min(720\\,ih)",
      "-frames:v", "1",
      "-q:v", "4",
      outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    const timeout = setTimeout(() => ffmpeg.kill("SIGKILL"), 60_000);
    let stderr = "";
    ffmpeg.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    ffmpeg.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg poster exited with code ${code}: ${stderr.slice(-300)}`));
    });
    ffmpeg.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function generateVideoPoster(videoPath: string, adId: number): Promise<string> {
  const cachedPoster = generatedVideoPosterCache.get(videoPath);
  if (cachedPoster) return cachedPoster;

  const activeJob = videoPosterJobs.get(videoPath);
  if (activeJob) return activeJob;

  const job = (async () => {
    const inputPath = `/tmp/ad-poster-${adId}-${Date.now()}.mp4`;
    const outputPath = `${inputPath}.jpg`;
    try {
      const videoFile = await objectStorageService.getObjectEntityFile(videoPath);
      const [videoBuffer] = await videoFile.download();
      await writeFile(inputPath, videoBuffer);
      await extractVideoPreviewFrame(inputPath, outputPath);
      const posterBuffer = await readFile(outputPath);
      const posterPath = await uploadCloudinaryImage(posterBuffer, "public-ad-poster");
      let updated;
      try {
        [updated] = await db
          .update(adsTable)
          .set({ image: posterPath })
          .where(and(eq(adsTable.id, adId), eq(adsTable.videoPath, videoPath)))
          .returning({ image: adsTable.image });
      } catch (error) {
        await deleteCloudinaryImage(posterPath).catch(() => {});
        throw error;
      }
      const resolvedPosterPath = updated?.image ?? posterPath;
      generatedVideoPosterCache.set(videoPath, resolvedPosterPath);
      return resolvedPosterPath;
    } finally {
      await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
    }
  })();

  videoPosterJobs.set(videoPath, job);
  try {
    return await job;
  } finally {
    videoPosterJobs.delete(videoPath);
  }
}

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.get("/storage/video-poster", async (req: Request, res: Response) => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  const refreshRequested = req.query.refresh === "1";
  if (!rawPath.startsWith("/objects/")) {
    res.status(400).json({ error: "Chemin vidéo invalide" });
    return;
  }
  if (refreshRequested) {
    const adminCode = req.headers["x-admin-code"];
    if (typeof adminCode !== "string" || !await isAdminAny(adminCode)) {
      res.status(403).json({ error: "Régénération du poster non autorisée" });
      return;
    }
  }

  const [ad] = await db
    .select({ id: adsTable.id, videoPath: adsTable.videoPath, image: adsTable.image })
    .from(adsTable)
    .where(and(
      eq(adsTable.videoPath, rawPath),
      eq(adsTable.isPublished, true),
      gt(adsTable.endDate, new Date()),
    ))
    .limit(1);
  if (!ad?.videoPath) {
    res.status(404).end();
    return;
  }
  if (!refreshRequested) {
    const cachedPoster = generatedVideoPosterCache.get(rawPath);
    if (cachedPoster) {
      res.setHeader("Cache-Control", "public, max-age=86400");
        res.redirect(302, parseCloudinaryImageUrl(cachedPoster) ? cachedPoster : `/api/storage${cachedPoster}`);
      return;
    }
  } else {
    generatedVideoPosterCache.delete(rawPath);
  }

  try {
    const posterPath = await generateVideoPoster(ad.videoPath, ad.id);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.redirect(302, parseCloudinaryImageUrl(posterPath) ? posterPath : `/api/storage${posterPath}`);
    return;
  } catch (error) {
    req.log.warn({ error, adId: ad.id }, "Unable to generate ad video poster");
    // A previously stored poster is still safer than a blank video frame if
    // FFmpeg or object storage is temporarily unavailable.
    if (ad.image) {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.redirect(302, parseCloudinaryImageUrl(ad.image) ? ad.image : `/api/storage${ad.image}`);
      return;
    }
    res.status(404).end();
  }
});

async function requireUploadActor(req: Request, res: Response, next: NextFunction): Promise<void> {
  const adminCode = req.headers["x-admin-code"];
  if (typeof adminCode === "string" && await isAdminAny(adminCode)) {
    res.locals.uploadOwner = "admin-media";
    next();
    return;
  }
  const vendor = await authenticateVendorRequest(req);
  const isActiveVendor = Boolean(
    vendor?.isPublished &&
    vendor.expiryDate &&
    vendor.expiryDate.getTime() > Date.now(),
  );
  let canEditTourisme = false;
  const rawTourismeListingId = req.headers["x-tourisme-listing-id"];
  if (vendor?.verified && typeof rawTourismeListingId === "string") {
    const tourismeListingId = Number(rawTourismeListingId);
    if (Number.isInteger(tourismeListingId) && tourismeListingId > 0) {
      const [catalog] = await db
        .select({ id: listingsTable.id })
        .from(listingsTable)
        .where(and(
          eq(listingsTable.id, tourismeListingId),
          phoneEq(listingsTable.phone, normalizePhone(vendor.phone)),
          eq(listingsTable.sector, "Tourisme"),
        ))
        .limit(1);
      canEditTourisme = Boolean(catalog);
    }
  }
  if (vendor?.verified && (isActiveVendor || canEditTourisme)) {
    res.locals.uploadOwner = `vendor:${vendor.id}`;
    next();
    return;
  }
  res.status(401).json({ error: "Authentification requise pour envoyer un fichier" });
}

/**
 * POST /storage/uploads/video
 *
 * Accept a raw video file (multipart/form-data, field "video").
 * If the file is > 30 MB, compress with ffmpeg (720p max, CRF 26, H.264+AAC).
 * Upload the result to object storage and return the objectPath.
 */
router.post(
  "/storage/uploads/video",
  requireUploadActor,
  videoUpload.single("video"),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Aucun fichier vidéo reçu" });
      return;
    }

    if (activeVideoJobs >= 2) {
      await unlink(file.path).catch(() => {});
      res.status(503).json({ error: "Le traitement vidéo est occupé. Réessayez plus tard." });
      return;
    }
    const inputPath = file.path;
    const outputPath = `${file.path}_compressed.mp4`;

    try {
      const inputBuffer = await readFile(inputPath);
      validateFileBytes(inputBuffer, file.mimetype, ["video"]);
      activeVideoJobs += 1;
      const { originalSize, compressedSize } = await compressVideo(inputPath, outputPath);
      if (compressedSize > 50 * 1024 * 1024) {
        throw new Error("compressed_video_too_large");
      }

      // Read compressed file into a buffer and upload to object storage
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(outputPath);
        stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      const buffer = Buffer.concat(chunks);
      validateFileBytes(buffer, "video/mp4", ["video"]);

      const objectPath = await objectStorageService.uploadObjectEntity(buffer, "video/mp4", {
        owner: String(res.locals.uploadOwner),
        visibility: "public",
      });

      req.log.info({ originalSize, compressedSize, objectPath }, "Video compressed and uploaded");

      res.json({ objectPath, originalSize, compressedSize });
    } catch (err) {
      req.log.warn({ err }, "Video rejected or compression failed");
      res.status(400).json({ error: "Vidéo invalide, trop volumineuse ou non prise en charge" });
    } finally {
      activeVideoJobs = Math.max(0, activeVideoJobs - 1);
      // Clean up temp files
      await Promise.allSettled([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {}),
      ]);
    }
  },
);

/**
 * Images are uploaded through the API so the server can validate the real
 * signature and dimensions before any bytes reach persistent storage.
 */
router.post("/storage/uploads/image", requireUploadActor, imageUpload.single("image"), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Aucune image reçue" });
    return;
  }
  try {
    const buffer = await readFile(file.path);
    try {
      validateFileBytes(buffer, file.mimetype, ["image"]);
    } catch {
      res.status(400).json({ error: "Image invalide ou format non pris en charge" });
      return;
    }
    const objectPath = await uploadCloudinaryImage(buffer, String(res.locals.uploadOwner));
    res.status(201).json({ objectPath });
  } catch (error) {
    req.log.warn({ err: error }, "Cloudinary image upload failed");
    res.status(502).json({ error: "Envoi de l'image indisponible" });
  } finally {
    await unlink(file.path).catch(() => {});
  }
});

router.post("/storage/uploads/request-url", (_req: Request, res: Response) => {
  res.status(410).json({ error: "Les uploads directs sont désactivés pour des raisons de sécurité" });
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
 * Redirects to a time-limited signed GCS URL instead of proxying the stream.
 * This offloads bandwidth from Express, enables native Range request support
 * (video seeking, buffering) and scales without bottleneck.
 * Signed URLs expire after 1 hour — the browser/CDN can cache during that window.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const policy = await getObjectAclPolicy(objectFile);
    if (policy?.visibility !== "public") {
      if (policy) {
        res.status(403).json({ error: "Accès privé refusé" });
        return;
      }
      // Legacy objects have no ACL metadata. Preserve public marketplace media,
      // but never expose legacy chat attachments through the generic route.
      const [privateMessage] = await db.select({ id: messagesTable.id })
        .from(messagesTable)
        .where(eq(messagesTable.fileUrl, objectPath))
        .limit(1);
      if (privateMessage) {
        res.status(403).json({ error: "Accès privé refusé" });
        return;
      }
    }
    const signedUrl = await objectStorageService.signObjectEntityReadURL(objectPath, 600);

    res.setHeader("Cache-Control", "private, max-age=600");
    res.redirect(302, signedUrl);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error redirecting to signed object URL");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * POST /admin/storage/cleanup
 *
 * Find and delete orphan files in Object Storage only when no persisted
 * marketplace entity still references them.
 */
router.post("/admin/storage/cleanup", async (req: Request, res: Response) => {
  const parsed = AdminStorageCleanupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Champs invalides" });
    return;
  }
  if (!await isSuperAdmin(parsed.data.password)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const allPaths = await objectStorageService.listAllObjectEntityPaths();

    const [listings, ads, vendors, messages, services, events] = await Promise.all([
      db.select({ images: listingsTable.images }).from(listingsTable),
      db.select({ image: adsTable.image, videoPath: adsTable.videoPath }).from(adsTable),
      db.select({ profilePhoto: vendorsTable.profilePhoto }).from(vendorsTable),
      // A deleted message can still be visible to the other participant, so
      // its attachment remains a live storage reference until the message row
      // itself is removed by conversation cleanup.
      db.select({ fileUrl: messagesTable.fileUrl }).from(messagesTable),
      db.select({ image: servicesTable.image, videoPath: servicesTable.videoPath }).from(servicesTable),
      db.select({ flyerImage: eventsTable.flyerImage, videoPath: eventsTable.videoPath }).from(eventsTable),
    ]);

    const usedPaths = collectReferencedObjectPaths({
      listings,
      ads,
      vendors,
      messages,
      services,
      events,
    });

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
