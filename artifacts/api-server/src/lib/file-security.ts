export type SafeFileKind = "image" | "audio" | "pdf" | "video";

export type SafeFile = {
  kind: SafeFileKind;
  contentType: string;
};

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((value, index) => buffer[index] === value);
}

function ascii(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString("ascii");
}

function detectFile(buffer: Buffer): SafeFile | null {
  if (buffer.length < 12) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { kind: "image", contentType: "image/jpeg" };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "image", contentType: "image/png" };
  }
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP") {
    return { kind: "image", contentType: "image/webp" };
  }
  if (ascii(buffer, 0, 5) === "%PDF-") return { kind: "pdf", contentType: "application/pdf" };
  if (ascii(buffer, 0, 4) === "OggS") return { kind: "audio", contentType: "audio/ogg" };
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WAVE") {
    return { kind: "audio", contentType: "audio/wav" };
  }
  if (ascii(buffer, 0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return { kind: "audio", contentType: "audio/mpeg" };
  }
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: "video", contentType: "video/webm" };
  }
  if (ascii(buffer, 4, 4) === "ftyp") {
    return { kind: "video", contentType: "video/mp4" };
  }
  return null;
}

function imageDimensions(buffer: Buffer, contentType: string): { width: number; height: number } | null {
  if (contentType === "image/png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (contentType === "image/webp" && buffer.length >= 30 && ascii(buffer, 12, 4) === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (contentType !== "image/jpeg") return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function declaredTypeMatches(declaredType: string, detected: SafeFile): boolean {
  const normalized = declaredType.toLowerCase().split(";")[0].trim();
  if (!normalized || normalized === "application/octet-stream") return true;
  if (detected.kind === "image") {
    return normalized === detected.contentType || (normalized === "image/jpg" && detected.contentType === "image/jpeg");
  }
  if (detected.kind === "audio" && normalized.startsWith("audio/")) return true;
  if (detected.kind === "video" && normalized.startsWith("video/")) return true;
  return normalized === detected.contentType;
}

export function validateFileBytes(
  buffer: Buffer,
  declaredType: string,
  allowedKinds: readonly SafeFileKind[],
): SafeFile {
  let detected = detectFile(buffer);
  const normalizedDeclaredType = declaredType.toLowerCase().split(";")[0].trim();
  // MP4/WebM are containers; an audio-only recording legitimately shares
  // their container signature with video.
  if (
    detected?.kind === "video" &&
    normalizedDeclaredType.startsWith("audio/") &&
    allowedKinds.includes("audio")
  ) {
    detected = { kind: "audio", contentType: normalizedDeclaredType };
  }
  if (!detected || !allowedKinds.includes(detected.kind)) {
    throw new Error("unsupported_file_signature");
  }
  if (!declaredTypeMatches(declaredType, detected)) {
    throw new Error("file_type_mismatch");
  }
  if (detected.kind === "image") {
    const dimensions = imageDimensions(buffer, detected.contentType);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
      throw new Error("invalid_image");
    }
    if (dimensions.width > 8000 || dimensions.height > 8000 || dimensions.width * dimensions.height > 40_000_000) {
      throw new Error("image_dimensions_too_large");
    }
  }
  if (detected.kind === "pdf") {
    const sample = buffer.subarray(0, Math.min(buffer.length, 2 * 1024 * 1024)).toString("latin1");
    if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/i.test(sample)) {
      throw new Error("unsafe_pdf");
    }
  }
  return detected;
}