"use server";

// The ops-side twin of registerPartner()/addPartnerCar() in
// lib/partner-register.ts — creates a partner's login and first listing in
// one submit, on an ops member's behalf, instead of the partner doing it
// themselves. See supabase/131-ops-onboarding.sql for the RPCs this calls.

import { randomBytes } from "crypto";
import { getOpsSession } from "@/lib/ops-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPartnerOnboardingEmail } from "@/lib/email";
import { sendPartnerOnboardingWhatsApp } from "@/lib/whatsapp";
import type { CabCategory, CabFuel } from "@/lib/cabs";

export type OpsActionResult =
  | { ok: true; message: string; partnerId: string; cabId: string; tempPassword: string }
  | { ok: false; message: string };

export type OpsPhotoSaveResult = { ok: true; message: string } | { ok: false; message: string };

const GENERIC_FAILURE = "Something went wrong. Try again.";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://andamango.in";

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

function generateTempPassword(): string {
  // 12 random bytes, base64url — short enough to read out loud on-site,
  // long enough that it's never anyone's real login password.
  return randomBytes(12).toString("base64url");
}

export async function onboardCabPartner(input: {
  businessName: string;
  email: string;
  phone: string;
  islandSlug: string;
  address: string;
  mapsUrl: string;
  category: CabCategory;
  model: string;
  seats: number;
  luggage: number;
  ac: boolean;
  fuel: CabFuel;
  boardNumber: string;
  fullDayPaise: number;
  airportSurchargePaise: number;
  nightSurchargePaise: number;
  perKmPaise: number;
  perMinPaise: number;
  meta: string;
}): Promise<OpsActionResult> {
  const opsSession = await getOpsSession();
  if (!opsSession) {
    return { ok: false, message: "Sign in as ops before onboarding a partner." };
  }

  const email = input.email.trim().toLowerCase();
  if (!email) {
    return { ok: false, message: "Partner email is required." };
  }

  const admin = supabaseAdmin();
  const tempPassword = generateTempPassword();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    if (createError) console.error("ops createUser failed:", createError);
    return {
      ok: false,
      // Surfaced verbatim (not GENERIC_FAILURE) when it's not the one case
      // with a friendlier message — this is an ops-only tool, and the raw
      // Supabase error (e.g. a misconfigured service-role key) is far more
      // actionable on-site than a generic failure would be.
      message: createError?.message?.includes("already been registered")
        ? "That email already has a login."
        : (createError?.message ?? GENERIC_FAILURE),
    };
  }
  const newUserId = created.user.id;

  const supabase = await supabaseServer();

  const { data: partnerData, error: partnerError } = await supabase.rpc("ops_register_partner", {
    p_user_id: newUserId,
    p_name: input.businessName,
    p_kind: "cab",
    p_island_slug: input.islandSlug,
    p_contact_phone: input.phone,
    p_address: input.address,
    p_maps_url: input.mapsUrl || null,
  });
  if (partnerError) {
    await admin.auth.admin.deleteUser(newUserId);
    return { ok: false, message: GENERIC_FAILURE };
  }
  const partnerRow = firstRow<{ ok: boolean; message: string; partner_id: string | null }>(partnerData);
  if (!partnerRow?.ok || !partnerRow.partner_id) {
    await admin.auth.admin.deleteUser(newUserId);
    return { ok: false, message: partnerRow?.message ?? GENERIC_FAILURE };
  }
  const partnerId = partnerRow.partner_id;

  const { data: cabData, error: cabError } = await supabase.rpc("ops_add_cab", {
    p_partner_id: partnerId,
    p_category: input.category,
    p_model: input.model,
    p_seats: input.seats,
    p_luggage: input.luggage,
    p_ac: input.ac,
    p_fuel: input.fuel,
    p_board_number: input.boardNumber,
    p_full_day_paise: input.fullDayPaise,
    p_airport_surcharge_paise: input.airportSurchargePaise,
    p_night_surcharge_paise: input.nightSurchargePaise,
    p_per_km_paise: input.perKmPaise,
    p_per_min_paise: input.perMinPaise,
    p_meta: input.meta,
  });
  if (cabError) return { ok: false, message: GENERIC_FAILURE };
  const cabRow = firstRow<{ ok: boolean; message: string; cab_id: string | null }>(cabData);
  if (!cabRow?.ok) return { ok: false, message: cabRow?.message ?? GENERIC_FAILURE };

  // Partner + listing are created either way at this point — a failed
  // password link or a failed send must never look like the onboarding
  // itself failed. The temp password returned below is the fallback.
  // Built from the token_hash rather than handed out as the raw
  // action_link: the link Supabase generates points at its own /verify
  // endpoint, whose redirect can land as either a PKCE `?code=` or a
  // hash-fragment token depending on project config. token_hash +
  // verifyOtp() on our own /partner/set-password page sidesteps that
  // entirely — it's a direct OTP exchange, not a redirect chain, and it
  // works the same regardless of flow type.
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  const setPasswordUrl = tokenHash
    ? `${SITE_URL}/partner/set-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
    : `${SITE_URL}/partner/login`;

  // Awaited, not fire-and-forget: a Server Action's execution environment
  // on Vercel can freeze the instant the response is sent, which silently
  // kills any dangling (un-awaited) promise — including the send itself and
  // the record_notification call logging it. A slower response here is a
  // fine trade for the send actually happening; a failed send still never
  // fails the onboarding, it's just caught and logged below.
  await Promise.all([
    sendPartnerOnboardingEmail(email, input.businessName, setPasswordUrl)
      .then((sent) =>
        supabase.rpc("record_notification", {
          p_channel: "email",
          p_recipient_type: "partner",
          p_recipient_address: email,
          p_kind: "partner_onboarding",
          p_status: sent ? "sent" : "failed",
          p_payload: { partner_name: input.businessName },
          p_partner_id: partnerId,
        }),
      )
      .catch((err) => console.error("onboarding email failed:", err)),
    input.phone
      ? sendPartnerOnboardingWhatsApp(input.phone, input.businessName, setPasswordUrl)
          .then((sent) =>
            supabase.rpc("record_notification", {
              p_channel: "whatsapp",
              p_recipient_type: "partner",
              p_recipient_address: input.phone,
              p_kind: "partner_onboarding",
              p_status: sent ? "sent" : "failed",
              p_payload: { partner_name: input.businessName },
              p_partner_id: partnerId,
            }),
          )
          .catch((err) => console.error("onboarding whatsapp failed:", err))
      : Promise.resolve(),
  ]);

  return {
    ok: true,
    message: "Partner onboarded.",
    partnerId,
    cabId: cabRow.cab_id!,
    tempPassword,
  };
}

/** Called from the photos step right after onboardCabPartner succeeds —
 *  split out because the cab doesn't have an id to attach photos to until
 *  the call above returns one. Cover photo is optional (partners.cover_photo_path
 *  stays null if skipped); listing photos are likewise optional here — a
 *  partner with none can still add them later from their own dashboard. */
export async function saveOpsCabPhotos(
  partnerId: string,
  cabId: string,
  coverPhotoPath: string | null,
  listingPhotoPaths: string[],
): Promise<OpsPhotoSaveResult> {
  const opsSession = await getOpsSession();
  if (!opsSession) {
    return { ok: false, message: "Sign in as ops before saving photos." };
  }

  const supabase = await supabaseServer();

  if (coverPhotoPath) {
    const { error } = await supabase.rpc("ops_set_cover_photo", {
      p_partner_id: partnerId,
      p_path: coverPhotoPath,
    });
    if (error) return { ok: false, message: GENERIC_FAILURE };
  }

  if (listingPhotoPaths.length > 0) {
    const { error } = await supabase.rpc("ops_set_listing_photos", {
      p_kind: "cab",
      p_partner_id: partnerId,
      p_id: cabId,
      p_paths: listingPhotoPaths,
    });
    if (error) return { ok: false, message: GENERIC_FAILURE };
  }

  return { ok: true, message: "Photos saved." };
}
