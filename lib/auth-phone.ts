"use client";

// Signing in with a phone number — the real one, where the number becomes an
// identity on auth.users rather than a field on traveller_profiles.
//
// The difference matters. lib/phone-otp.ts (115) asked Twilio whether a code
// matched and then stamped traveller_profiles.verified_at; the account
// underneath stayed the anonymous one living in this device's cookies. Clear
// the cookies, reinstall the app, pick up a second phone, and the bookings
// were gone — only the WhatsApp reference code got them back. Here Supabase
// owns the OTP, so the number is the account, and it travels.
//
// Two paths behind one form, decided by whether the number already has an
// account:
//
//   new number      updateUser({phone}) upgrades the *current anonymous user
//                   in place*. auth.uid() never changes, so every booking
//                   made before signing in comes along. Verified with
//                   type: "phone_change".
//
//   known number    signInWithOtp() and verify with type: "sms". This
//                   replaces the current session with the existing account.
//
// We don't ask the database which case it is — that would be a public "does
// this number have an account here" oracle. We just try the upgrade and read
// the error.

import { supabaseBrowser, ensureSession } from "./supabase-browser";

/** Mirrors public.normalise_phone (140). Null when it isn't a plausible number. */
export function normalisePhone(raw: string): string | null {
  let clean = (raw ?? "").replace(/[^0-9+]/g, "");

  if (/^0[6-9][0-9]{9}$/.test(clean)) clean = `+91${clean.slice(1)}`;
  else if (/^[6-9][0-9]{9}$/.test(clean)) clean = `+91${clean}`;
  else if (/^91[6-9][0-9]{9}$/.test(clean)) clean = `+${clean}`;

  return /^\+[1-9][0-9]{7,14}$/.test(clean) ? clean : null;
}

/** Which of the two paths a verification is on — the OTP type differs. */
export type SignInMode = "upgrade" | "existing";

export type StartResult =
  | { ok: true; phone: string; mode: SignInMode }
  | { ok: false; message: string };

export type VerifyResult = { ok: true } | { ok: false; message: string };

type AuthErrorish = { code?: string; status?: number; message?: string };

/** Does this error mean "that number belongs to somebody else already"? */
function phoneTaken(error: AuthErrorish | null): boolean {
  if (!error) return false;
  if (error.code === "phone_exists") return true;
  const m = (error.message ?? "").toLowerCase();
  return m.includes("already registered") || m.includes("already been registered");
}

/**
 * Send the code. Returns the normalised number and which path we're on, both
 * of which have to come back to completePhoneSignIn().
 */
export async function startPhoneSignIn(raw: string): Promise<StartResult> {
  const phone = normalisePhone(raw);
  if (!phone) {
    return { ok: false, message: "That doesn't look right. A 10-digit mobile is enough." };
  }

  // There has to be a session to upgrade. Normally SessionBoot has already
  // made one; this covers the person who opened Profile on a slow connection
  // and went straight for Log in.
  try {
    await ensureSession();
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection." };
  }

  // Clear abandoned attempts for this number first — see migration 140. Left
  // alone, a half-finished verification by someone else can make Supabase
  // attach this number to their account instead of the right one.
  await supabaseBrowser.rpc("clear_stale_phone_change", { p_phone: phone });

  const { error } = await supabaseBrowser.auth.updateUser({ phone });

  if (!error) return { ok: true, phone, mode: "upgrade" };

  if (phoneTaken(error)) {
    const { error: otpError } = await supabaseBrowser.auth.signInWithOtp({ phone });
    if (otpError) return { ok: false, message: sendFailure(otpError) };
    return { ok: true, phone, mode: "existing" };
  }

  return { ok: false, message: sendFailure(error) };
}

/** Twilio and GoTrue failures, said in a way that helps rather than alarms. */
function sendFailure(error: AuthErrorish): string {
  if (error.status === 429) {
    return "Too many codes requested. Wait a minute and try again.";
  }
  const m = (error.message ?? "").toLowerCase();
  if (m.includes("sms") && m.includes("not enabled")) {
    return "Phone sign-in isn't switched on yet.";
  }
  if (m.includes("invalid") && m.includes("phone")) {
    return "That doesn't look right. A 10-digit mobile is enough.";
  }
  // Twilio's fraud guard refuses numbers that don't look like a real mobile
  // (error 60238), e.g. a US number typed without +1, which we read as +91.
  if (m.includes("blocked")) {
    return "We couldn't text that number. Check it's a mobile number — add the country code if it isn't Indian.";
  }
  // Never show the raw provider error to travellers (App Review saw it);
  // keep it in the console for debugging.
  console.error("[andaman-go] phone OTP send failed:", error.message);
  return "Couldn't send a code. Try again in a moment.";
}

/**
 * Check the code. On success the session is the permanent account, and the
 * number is copied onto traveller_profiles so tickets, WhatsApp and the
 * bookings' contact_phone keep working exactly as before — set_my_phone (007)
 * also backfills any booking of theirs that has no number on it yet.
 */
export async function completePhoneSignIn(
  phone: string,
  code: string,
  mode: SignInMode,
): Promise<VerifyResult> {
  const token = (code ?? "").replace(/[^0-9]/g, "");
  if (token.length < 4) return { ok: false, message: "Enter the code we texted you." };

  const { error } = await supabaseBrowser.auth.verifyOtp({
    phone,
    token,
    type: mode === "upgrade" ? "phone_change" : "sms",
  });

  if (error) {
    const m = (error.message ?? "").toLowerCase();
    if (m.includes("expired")) return { ok: false, message: "That code has expired. Send a new one." };
    return { ok: false, message: "That code didn't match." };
  }

  // Best effort, and deliberately not fatal: the sign-in itself has already
  // succeeded by this point, and failing the whole thing over a profile row
  // would strand somebody who is, in fact, signed in.
  try {
    await supabaseBrowser.rpc("set_my_phone", { p_phone: phone });
    await supabaseBrowser.rpc("mark_my_phone_verified", { p_phone: phone });
  } catch {
    // ignored on purpose — see above
  }

  return { ok: true };
}

/** Whether the current session is still a throwaway anonymous one. */
export async function isAnonymousSession(): Promise<boolean> {
  const { data } = await supabaseBrowser.auth.getUser();
  return data.user?.is_anonymous !== false;
}
