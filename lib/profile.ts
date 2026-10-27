"use server";

// The traveller's contact details.
//
// Deliberately not part of signing in. It is asked for after a booking exists,
// on the confirmation screen, phrased as "where should we send your ticket?" —
// because that is what it is for. Nobody experiences that as registration,
// and nobody abandons a booking over it.
//
// Phone and email get the same treatment on purpose: both are addresses, not
// identity, both collected without proof of ownership. We tried verifying
// email with Supabase's own OTP first — it worked, but it wasn't needed: the
// point of asking was always "also send the ticket here," not "prove this
// inbox is yours." Real verification (Twilio, OTP, the works) is saved for
// the phone number, planned for just before the app goes live, once the
// partner app and admin console exist too.

import { supabaseServer } from "./supabase-server";

export type PhoneResult = { ok: true; phone: string } | { ok: false; message: string };
export type EmailResult = { ok: true; email: string } | { ok: false; message: string };

/** The number on file, or null if we have never asked. */
export async function getMyPhone(): Promise<string | null> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("traveller_profiles")
    .select("phone")
    .maybeSingle();

  if (error) return null;
  return data?.phone ?? null;
}

/** Whether the number on file has passed OTP verification (115). */
export async function getMyPhoneVerified(): Promise<boolean> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("traveller_profiles")
    .select("verified_at")
    .maybeSingle();

  if (error) return false;
  return data?.verified_at != null;
}

/**
 * Save it. The database does the tidying — a bare Indian mobile gets +91, a
 * number typed with spaces or dashes comes out clean — and attaches it to any
 * booking of theirs that does not have one yet.
 */
export async function saveMyPhone(phone: string): Promise<PhoneResult> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase.rpc("set_my_phone", { p_phone: phone });

  if (error) {
    if (error.message.includes("does not look like a phone number")) {
      return {
        ok: false,
        message: "That doesn't look right. A 10-digit mobile is enough.",
      };
    }
    if (error.message.includes("not signed in")) {
      return { ok: false, message: "Reload the page and try again." };
    }
    return { ok: false, message: "Couldn't save that number. Try again." };
  }

  return { ok: true, phone: String(data) };
}

/** The email on file, or null if we have never asked. */
export async function getMyEmail(): Promise<string | null> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("traveller_profiles")
    .select("email")
    .maybeSingle();

  if (error) return null;
  return data?.email ?? null;
}

/**
 * Save it. Light validation only — it just needs to look like an email — and
 * it attaches to any booking of theirs that does not have one yet, same as
 * the phone number.
 */
export async function saveMyEmail(email: string): Promise<EmailResult> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase.rpc("set_my_email", { p_email: email });

  if (error) {
    if (error.message.includes("does not look like an email address")) {
      return { ok: false, message: "That doesn't look like an email address." };
    }
    if (error.message.includes("not signed in")) {
      return { ok: false, message: "Reload the page and try again." };
    }
    return { ok: false, message: "Couldn't save that. Try again." };
  }

  return { ok: true, email: String(data) };
}
