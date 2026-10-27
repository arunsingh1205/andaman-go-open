"use server";

// The "I'm interested" sign-up for a free Community Service activity.
//
// Deliberately thin, same as lib/book.ts: the check and the write happen
// together inside community_signup() (072), where consent, the age limits and
// "is this still listed" can't be skipped. This file only turns the RPC's
// result into something the panel can render, and — on success — hands back
// the organiser's WhatsApp group link for the confirmation screen.

import { supabaseServer } from "./supabase-server";

export type InterestRequest = {
  slug: string;
  fullName: string;
  /** One of age / dateOfBirth is required; the RPC enforces it. */
  age: number | null;
  dateOfBirth: string | null;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  consent: boolean;
};

export type InterestResult =
  | { ok: true; whatsappGroupUrl: string | null }
  | { ok: false; message: string };

const GENERIC_FAILURE = "Something went wrong. Try again.";

export async function submitInterest(input: InterestRequest): Promise<InterestResult> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase.rpc("community_signup", {
    p_slug: input.slug,
    p_full_name: input.fullName,
    p_age: input.age,
    p_date_of_birth: input.dateOfBirth,
    p_phone: input.phone,
    p_emergency_contact_name: input.emergencyContactName,
    p_emergency_contact_phone: input.emergencyContactPhone,
    p_consent: input.consent,
  });

  if (error) {
    if (error.message.includes("not signed in")) {
      return { ok: false, message: "Reload the page and try again." };
    }
    return { ok: false, message: GENERIC_FAILURE };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok: boolean; message: string; whatsapp_group_url: string | null }
    | undefined;

  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, whatsappGroupUrl: row.whatsapp_group_url ?? null };
}
