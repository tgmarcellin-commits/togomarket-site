import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { spawn } from "child_process";
import { createReadStream, statSync } from "fs";
import { unlink } from "fs/promises";
import multer from "multer";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  AdminStorageCleanupBody,
  AdminStorageCleanupResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { db, listingsTable, adsTable } from "@workspace/db";
import { isSuperAdmin } from "../lib/admin-auth";

const upload = multer({
  dest: "/tmp",
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max
});

/** Run ffmpeg to compress a video file. Returns path to compressed output. */
function compressVideo(inputPath: string, outputPath: string): Promise<{ originalSize: number; compressedSize: number }> {
  return new Promise((resolve, reject) => {
    const originalSize = statSync(inputPath).size;

    const args = [
      "-y",
      "-i", inputPath,
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

    let stderr = "";
    ffmpeg.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    ffmpeg.on("close", (code) => {
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

    ffmpeg.on("error", reject);
  });
}

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/video
 *
 * Accept a raw video file (multipart/form-data, field "video").
 * If the file is > 30 MB, compress with ffmpeg (720p max, CRF 26, H.264+AAC).
 * Upload the result to object storage and return the objectPath.
 */
router.post(
  "/storage/uploads/video",
  upload.single("video"),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Aucun fichier vidéo reçu" });
      return;
    }

    const inputPath = file.path;
    const outputPath = `${file.path}_compressed.mp4`;

    try {
      const { originalSize, compressedSize } = await compressVideo(inputPath, outputPath);

      // Read compressed file into a buffer and upload to object storage
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(outputPath);
        stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      const buffer = Buffer.concat(chunks);

      const objectPath = await objectStorageService.uploadObjectEntity(buffer, "video/mp4");

      req.log.info({ originalSize, compressedSize, objectPath }, "Video compressed and uploaded");

      res.json({ objectPath, originalSize, compressedSize });
    } catch (err) {
      req.log.error({ err }, "Video compression failed");
      res.status(500).json({ error: "Échec de la compression vidéo" });
    } finally {
      // Clean up temp files
      await Promise.allSettled([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {}),
      ]);
    }
  },
);

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

    const signedUrl = await objectStorageService.signObjectEntityReadURL(objectPath, 3600);

    res.setHeader("Cache-Control", "private, max-age=3600");
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
 * Find and delete orphan files in Object Storage (files not referenced by any listing or ad).
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
