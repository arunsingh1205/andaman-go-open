"use client";

// Reading what partners uploaded, from the admin side. Cover/listing photos
// are in the public partner-photos bucket — partnerPhotoUrl() from
// partner-storage.ts already covers those. License documents are private
// (partner-licenses), so an admin needs a short-lived signed URL instead of
// a public one; the "admins read all license docs" policy from
// 012-admin-review.sql is what actually allows the signing to succeed for
// any partner's folder, not just the caller's own.

import { supabaseBrowser } from "./supabase-browser";

export async function adminLicenseDocUrl(path: string): Promise<string | null> {
  const { data, error } = await supabaseBrowser.storage
    .from("partner-licenses")
    .createSignedUrl(path, 120);
  if (error || !data) return null;
  return data.signedUrl;
}
