"use client";

// Partner-uploaded files — shop cover photos, per-listing photos, license
// documents — all go through this one helper. The bucket and the RLS
// policies on storage.objects (011-partner-onboarding.sql) are what actually
// enforce "only your own folder"; this just builds a path that matches what
// those policies expect (`<partner_id>/<random>.<ext>`) and surfaces a
// message a partner can read instead of a raw Supabase error.
//
// A licence is whatever the government handed the partner: a PDF from a
// portal, a photo of a paper certificate, a scan. So the licence bucket takes
// PDFs and images, and this helper works hard to figure out *which* — see
// resolveType() for why trusting `file.type` alone breaks real uploads.

import { supabaseBrowser } from "./supabase-browser";

export type UploadResult = { ok: true; path: string } | { ok: false; message: string };

// A phone photo of a document fits easily in 8 MB; a multi-page scanned PDF
// of a dive-shop licence often doesn't, so licences get more room. Both stay
// under the bucket's own file_size_limit (060-partner-licence-uploads.sql).
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_LICENSE_BYTES = 15 * 1024 * 1024;
// A short property walkthrough clip, opted into per-caller (103-stay-media) —
// most listing forms never pass allowVideo, so this only ever applies where
// a caller explicitly asks for it. Stays under the partner-photos bucket's
// own file_size_limit (also 103-stay-media).
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const LICENSE_TYPES = [...PHOTO_TYPES, "image/heic", "image/heif", "image/gif", "application/pdf"];

// Browsers are unreliable about `file.type`. An iPhone picking from Files
// reports image/heic; several Android file managers report an empty string or
// application/octet-stream for a perfectly good PDF; a few old WebViews say
// image/jpg, which is not a real MIME type. Since 058 gave the buckets an
// allowed_mime_types list, any of those now gets rejected server-side too —
// so the extension is the fallback source of truth, and the resolved type is
// stamped onto the upload rather than left to the browser.
const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

// Spellings browsers actually emit for types we already accept.
const TYPE_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "image/heic-sequence": "image/heic",
  "image/heif-sequence": "image/heif",
  "application/x-pdf": "application/pdf",
  "application/acrobat": "application/pdf",
  "applications/vnd.pdf": "application/pdf",
};

// A phone camera JPEG is routinely 4-8 MB at 3000+ px wide — nothing in this
// app ever displays a photo anywhere near that size, so uploading the
// original is most of why "upload a picture" feels slow, especially on
// mobile data. 1600px covers even a retina-width hero photo with room to
// spare.
const MAX_PHOTO_DIMENSION = 1600;
const PHOTO_QUALITY = 0.82;
const COMPRESSIBLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Downscale + recompress a photo client-side before it ever reaches the
 * network. Falls back to the original file untouched on any decode/encode
 * failure (an unusual format, an old WebView) or if compressing wouldn't
 * actually shrink it — so a compression bug or edge case never blocks an
 * upload outright, it just skips the optimisation.
 */
async function compressPhoto(file: File, type: string): Promise<File | Blob> {
  if (!COMPRESSIBLE_TYPES.has(type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      // Already a sensible size — nothing worth gaining.
      bitmap.close();
      return file;
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, PHOTO_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  }
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * The MIME type to actually upload this file as, or null if it isn't one of
 * the types the bucket takes. What the browser claims wins when it is
 * believable; otherwise the file extension decides.
 */
function resolveType(file: File, allowed: string[]): string | null {
  const claimed = file.type.split(";")[0].trim().toLowerCase();
  const normalised = TYPE_ALIASES[claimed] ?? claimed;
  if (allowed.includes(normalised)) return normalised;

  const fromExt = TYPE_BY_EXT[fileExtension(file.name)];
  if (fromExt && allowed.includes(fromExt)) return fromExt;

  return null;
}

export async function uploadPartnerFile(
  bucket: "partner-photos" | "partner-licenses",
  partnerId: string,
  file: File,
  opts?: { allowVideo?: boolean },
): Promise<UploadResult> {
  const isLicense = bucket === "partner-licenses";
  const allowedTypes = isLicense
    ? LICENSE_TYPES
    : opts?.allowVideo
      ? [...PHOTO_TYPES, ...VIDEO_TYPES]
      : PHOTO_TYPES;

  const type = resolveType(file, allowedTypes);
  if (!type) {
    return {
      ok: false,
      message: isLicense
        ? "That file type isn't allowed — upload a PDF or a photo of your licence (JPG, PNG, WEBP or HEIC)."
        : opts?.allowVideo
          ? "That file type isn't allowed — use a JPG, PNG or WEBP photo, or an MP4, MOV or WEBM video."
          : "That file type isn't allowed — use a JPG, PNG or WEBP photo.",
    };
  }

  const maxBytes = isLicense ? MAX_LICENSE_BYTES : VIDEO_TYPES.includes(type) ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;

  // Shrink before the size check, not after — a phone photo that's too big
  // to upload is often small enough to upload once it's been resized.
  const compressed = await compressPhoto(file, type);

  if (compressed.size > maxBytes) {
    return {
      ok: false,
      message: `That file is too large — keep it under ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    };
  }

  // The extension follows the resolved type, so a PDF the browser mislabelled
  // never lands in the bucket named .jpg — the admin reviewing it opens the
  // signed URL and the file has to be what it says it is.
  const path = `${partnerId}/${crypto.randomUUID()}.${EXT_BY_TYPE[type]}`;

  // supabase-js sends a File/Blob as multipart and lets the *blob's* type
  // become the stored MIME — `contentType` alone is ignored on that path.
  // compressPhoto()'s output already carries the resolved type; an untouched
  // File still needs the re-slice so a browser-mistyped file survives the
  // bucket's allowed_mime_types check. slice() is a view, so nothing is
  // copied.
  const body =
    compressed instanceof File
      ? compressed.type === type
        ? compressed
        : compressed.slice(0, compressed.size, type)
      : compressed;

  const { error } = await supabaseBrowser.storage.from(bucket).upload(path, body, {
    cacheControl: "3600",
    contentType: type,
    upsert: false,
  });

  if (error) {
    // Keep the real reason reachable for support — the partner sees plain
    // English, whoever they call sees the console.
    console.error("partner file upload failed", { bucket, path, type, error });
    const reason = error.message.toLowerCase();
    if (reason.includes("mime") || reason.includes("content type")) {
      return { ok: false, message: "The server didn't accept that file type. Try a PDF or a JPG." };
    }
    if (reason.includes("exceed") || reason.includes("too large") || reason.includes("size")) {
      return { ok: false, message: "That file is too large. Try a smaller scan or photo." };
    }
    if (reason.includes("row-level security") || reason.includes("unauthorized")) {
      return { ok: false, message: "Your session expired. Sign in again and retry the upload." };
    }
    return { ok: false, message: "Couldn't upload that file. Check your connection and try again." };
  }

  return { ok: true, path };
}

/** The traveller-facing URL for something in the public partner-photos bucket. */
export function partnerPhotoUrl(path: string): string {
  return supabaseBrowser.storage.from("partner-photos").getPublicUrl(path).data.publicUrl;
}

const VIDEO_EXTS = new Set(["mp4", "mov", "webm"]);

/** Whether a partner-photos storage path is a video clip rather than a photo. */
export function isVideoPath(path: string): boolean {
  return VIDEO_EXTS.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
}
