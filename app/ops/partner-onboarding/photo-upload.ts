"use server";

// Uploads a photo on ops's behalf, during onboarding, before the partner has
// ever signed in. The existing "partners manage own photos" RLS policy on
// storage.objects (011) requires auth.uid() to already be linked to the
// target partner_id via partner_users — ops never is, by design, so a
// normal browser upload (lib/partner-storage.ts's uploadPartnerFile) would
// be rejected here. This goes through the service-role client instead,
// which bypasses that policy the same way account creation already does —
// see supabase/133-ops-onboarding-photos.sql for the RPCs that attach the
// resulting paths to the partner/listing row afterward.
//
// Deliberately simpler than uploadPartnerFile: no client-side compression
// (no browser Canvas APIs on the server), no HEIC/video handling — ops
// onboarding only ever needs a cover photo and a handful of listing photos,
// picked from whatever device ops is using on-site.

import { getOpsSession } from "@/lib/ops-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type OpsPhotoUploadResult = { ok: true; path: string } | { ok: false; message: string };

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function uploadOpsPartnerPhoto(partnerId: string, file: File): Promise<OpsPhotoUploadResult> {
  const session = await getOpsSession();
  if (!session) return { ok: false, message: "Sign in as ops before uploading." };

  const type = PHOTO_TYPES.includes(file.type) ? file.type : null;
  if (!type) return { ok: false, message: "Use a JPG, PNG or WEBP photo." };
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, message: "That file is too large — keep it under 8 MB." };
  }

  const path = `${partnerId}/${crypto.randomUUID()}.${EXT_BY_TYPE[type]}`;
  const { error } = await supabaseAdmin()
    .storage.from("partner-photos")
    .upload(path, file, { cacheControl: "3600", contentType: type, upsert: false });

  if (error) {
    console.error("ops photo upload failed", { path, error });
    return { ok: false, message: "Couldn't upload that photo. Try again." };
  }

  return { ok: true, path };
}
