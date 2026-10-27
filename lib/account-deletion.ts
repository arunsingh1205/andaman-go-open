"use server";

// In-app account deletion requests — App Store Review Guideline 5.1.1(v).
//
// Apple requires an app that lets someone create an account to also let them
// START deleting it from inside the app. A policy page saying "email us"
// (which is all /delete-account offered, and all Google Play asks for) is a
// guaranteed rejection on iOS, so this turns that page into a real button.
//
// It files a REQUEST rather than hard-deleting on the spot, which Apple
// permits where data has to be retained for legal reasons — booking and
// payment records are kept for the period Indian tax law requires (see the
// /delete-account page's "What we keep, and why"). What matters to review is
// that the traveller or partner never has to leave the app, compose an email,
// or phone anyone to set deletion in motion.
//
// Deliberately no new table: this emails support@andamango.in with everything
// needed to action the deletion, so it ships without a migration and without
// widening the anon-callable RPC surface that the 7 Sep security audit is
// already trying to shrink. If the volume ever justifies a queue, that's the
// point to add one.

import { supabaseServer } from "./supabase-server";
import { getMyPhone, getMyEmail } from "./profile";
import { sendAccountDeletionRequestEmail } from "./email";

export type DeletionRequestResult = { ok: true } | { ok: false; message: string };

/**
 * Files a deletion request for whoever is signed in on this request.
 *
 * `account` distinguishes the two apps: the traveller app signs in with an
 * anonymous Supabase session carrying a phone number, the partner dashboard
 * with a real email login. Both live in the same auth.users table, so the
 * user id alone doesn't say which one asked.
 */
export async function requestAccountDeletion(
  account: "traveller" | "partner",
  reason?: string,
): Promise<DeletionRequestResult> {
  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return { ok: false, message: "You're signed out. Reload the page and try again." };
  }

  // Best-effort: a partner has an email on the auth user, a traveller may have
  // saved a phone and/or an email against their anonymous session. Neither is
  // required for the request to be actionable — the user id always is.
  const [phone, email] = await Promise.all([
    getMyPhone().catch(() => null),
    getMyEmail().catch(() => null),
  ]);

  const sent = await sendAccountDeletionRequestEmail({
    account,
    userId: user.id,
    email: user.email ?? email,
    phone,
    reason: reason?.trim() || null,
    requestedAt: new Date().toISOString(),
  });

  if (!sent) {
    // RESEND_API_KEY missing, or Resend refused/timed out. Say so plainly
    // rather than showing a success screen for a request nobody received.
    return {
      ok: false,
      message: "Couldn't file that request just now. Please try again in a moment.",
    };
  }

  return { ok: true };
}
