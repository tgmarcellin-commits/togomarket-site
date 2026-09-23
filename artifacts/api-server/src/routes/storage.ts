import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { spawn } from "child_process";
import { statSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { unlink } from "fs/promises";
import multer from "multer";
import {
  AdminStorageCleanupBody,
  AdminStorageCleanupResponse,
} from "@workspace/api-zod";
import { uploadCloudinaryImage, deleteCloudinaryImage, parseCloudinaryImageUrl } from "../lib/cloudinary-image";
import { deleteCloudinaryMedia, listCloudinaryMedia, parseCloudinaryMediaUrl, uploadCloudinaryMedia } from "../lib/cloudinary-media";
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
      const parsed = parseCloudinaryMediaUrl(videoPath);
      if (parsed?.resourceType !== "video" || parsed.deliveryType !== "upload") {
        throw new Error("Video not stored on Cloudinary");
      }
      const videoResponse = await fetch(videoPath);
      if (!videoResponse.ok || Number(videoResponse.headers.get("content-length")) > 50 * 1024 * 1024) {
        throw new Error("Unable to download video for poster");
      }
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      if (videoBuffer.length > 50 * 1024 * 1024) throw new Error("Video too large for poster");
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

router.get("/storage/video-poster", async (req: Request, res: Response) => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  const refreshRequested = req.query.refresh === "1";
  if (parseCloudinaryMediaUrl(rawPath)?.resourceType !== "video") {
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
    // FFmpeg or Cloudinary is temporarily unavailable.
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
 * Upload the result to Cloudinary and return its HTTPS URL.
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

      const buffer = await readFile(outputPath);
      validateFileBytes(buffer, "video/mp4", ["video"]);

      let objectPath: string;
      try {
        objectPath = await uploadCloudinaryMedia(buffer, "video", String(res.locals.uploadOwner));
      } catch (error) {
        req.log.warn({ err: error }, "Cloudinary video upload failed");
        res.status(502).json({ error: "Envoi de la vidéo indisponible" });
        return;
      }

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

// Existing object-storage files cannot be served after the Google integration
// is removed. Fail explicitly; never attempt a metadata-server fallback.
router.get("/storage/public-objects/*filePath", (_req: Request, res: Response) => {
  res.status(410).json({ error: "Ancien fichier indisponible après retrait de Google Storage" });
});
router.get("/storage/objects/*path", (_req: Request, res: Response) => {
  res.status(410).json({ error: "Ancien fichier indisponible après retrait de Google Storage" });
});

/**
 * POST /admin/storage/cleanup
 *
 * Delete orphan Cloudinary media only when no persisted marketplace entity
 * still references it.
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
    const allPaths = await listCloudinaryMedia();

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

    const usedPaths = new Set([
      ...listings.flatMap((row) => row.images ?? []),
      ...ads.flatMap((row) => [row.image, row.videoPath]),
      ...vendors.map((row) => row.profilePhoto),
      ...messages.map((row) => row.fileUrl),
      ...services.flatMap((row) => [row.image, row.videoPath]),
      ...events.flatMap((row) => [row.flyerImage, row.videoPath]),
    ].filter((value): value is string => Boolean(value)).map((value) => value.startsWith("v:") ? value.slice(2) : value));
    const orphans = allPaths.filter((p) => !usedPaths.has(p));
    const results = await Promise.allSettled(orphans.map(deleteCloudinaryMedia));
    const deleted = results.filter((result) => result.status === "fulfilled").length;

    req.log.info({ deleted, failed: orphans.length - deleted }, "Cloudinary cleanup completed");
    res.json(AdminStorageCleanupResponse.parse({ deleted }));
  } catch (error) {
    req.log.error({ err: error }, "Storage cleanup failed");
    res.status(500).json({ error: "Cleanup failed" });
  }
});

export default router;
