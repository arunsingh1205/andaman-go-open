"use server";

// The ops-side twin of registerPartner()/addPartnerVehicle() in
// lib/partner-register.ts — creates a partner's login and first vehicle
// listing in one submit, on an ops member's behalf. See
// supabase/132-ops-onboarding-scope-and-rental.sql for the RPCs this calls.
// Same shape as ../cab/actions.ts — see that file's comments for the
// reasoning behind each step (temp password, token_hash recovery link,
// fire-and-forget notifications).

import { randomBytes } from "crypto";
import { getOpsSession } from "@/lib/ops-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPartnerOnboardingEmail } from "@/lib/email";
import { sendPartnerOnboardingWhatsApp } from "@/lib/whatsapp";
import type { VehicleType } from "@/lib/partner-register";

export type OpsActionResult =
  | { ok: true; message: string; partnerId: string; vehicleId: string; tempPassword: string }
  | { ok: false; message: string };

export type OpsPhotoSaveResult = { ok: true; message: string } | { ok: false; message: string };

const GENERIC_FAILURE = "Something went wrong. Try again.";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://andamango.in";

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

function generateTempPassword(): string {
  return randomBytes(12).toString("base64url");
}

export async function onboardRentalPartner(input: {
  businessName: string;
  email: string;
  phone: string;
  islandSlug: string;
  address: string;
  area: string;
  mapsUrl: string;
  type: VehicleType;
  model: string;
  ratePaise: number;
  seats: number;
  units: number;
  securityDepositPaise: number;
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
    p_kind: "rental",
    p_island_slug: input.islandSlug,
    p_contact_phone: input.phone,
    p_address: input.address,
    p_maps_url: input.mapsUrl,
    p_area: input.area,
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

  const { data: vehicleData, error: vehicleError } = await supabase.rpc("ops_add_rental", {
    p_partner_id: partnerId,
    p_type: input.type,
    p_model: input.model,
    p_rate_paise: input.ratePaise,
    p_seats: input.seats,
    p_meta: input.meta,
    p_units: input.units,
    p_security_deposit_paise: input.securityDepositPaise,
  });
  if (vehicleError) return { ok: false, message: GENERIC_FAILURE };
  const vehicleRow = firstRow<{ ok: boolean; message: string; vehicle_id: string | null }>(vehicleData);
  if (!vehicleRow?.ok) return { ok: false, message: vehicleRow?.message ?? GENERIC_FAILURE };

  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  const setPasswordUrl = tokenHash
    ? `${SITE_URL}/partner/set-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
    : `${SITE_URL}/partner/login`;

  // Awaited, not fire-and-forget — see ../cab/actions.ts for why: a
  // dangling promise here can get silently killed by Vercel freezing the
  // Server Action's execution environment right after the response sends.
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
    vehicleId: vehicleRow.vehicle_id!,
    tempPassword,
  };
}

/** Called from the photos step right after onboardRentalPartner succeeds —
 *  same shape as ../cab/actions.ts's saveOpsCabPhotos. */
export async function saveOpsRentalPhotos(
  partnerId: string,
  vehicleId: string,
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
      p_kind: "rental",
      p_partner_id: partnerId,
      p_id: vehicleId,
      p_paths: listingPhotoPaths,
    });
    if (error) return { ok: false, message: GENERIC_FAILURE };
  }

  return { ok: true, message: "Photos saved." };
}
