// Who is holding the phone, on the partner side.
//
// A partner can sign in two ways today: Google, or email + password. Google
// is self-serve — anybody can sign in with it and register their business on
// the spot (see /partner/not-linked); the account itself only exists from
// the first time someone actually signs in with it. Email + password logins
// are the ones Arun still creates by hand. `partner_users` is the one-row
// link from whichever auth account it is to the partners row it can act for.
//
// Phone number login, and requiring a verified phone even for
// email/Google logins, are both intentionally not built yet — they wait on
// the same Twilio/WhatsApp OTP work as the traveller side.
//
// Every partner screen calls getPartnerAuthState() first and does nothing
// else until it gets an answer. There are three distinct answers, not two:
// nobody's signed in, somebody's signed in but not linked to a business yet,
// or somebody's signed in and linked. The middle one matters on its own —
// bouncing it back to "signed in" would either loop or look broken.
//
// The dashboard layout checks this, and then every page under it checks it
// again (via getPartnerSession()) — wrapped in React's cache() so those two
// calls collapse into one auth round trip per request instead of two. That
// memoization is why signOutPartner() lives in its own file
// (partner-signout.ts) instead of here: it's a real Server Action, imported
// directly by client components, and Next requires "use server" files used
// that way to carry the directive at the top of the file — which would have
// made every export here a Server Action and broken cache()'s memoization.

import { cache } from "react";
import { supabaseServer } from "./supabase-server";

export type PartnerSession = {
  userId: string;
  partnerId: string;
  partnerName: string;
  partnerPhotoPath: string | null;
  role: "owner" | "staff";
  /** True for a login ops just created on a partner's behalf (131) — the
   *  dashboard layout bounces this straight to /partner/set-password until
   *  they replace the temp password with their own. */
  mustResetPassword: boolean;
};

export type PartnerAuthState =
  | { status: "signed-out" }
  | { status: "unlinked"; email: string | null; viaApple: boolean }
  | { status: "linked"; session: PartnerSession };

export const getPartnerAuthState = cache(async (): Promise<PartnerAuthState> => {
  const supabase = await supabaseServer();

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  const user = userResult?.user;
  if (userError || !user) return { status: "signed-out" };

  // The traveller side hands every visitor an anonymous account the moment
  // the app opens (see supabase-browser.ts), so by the time somebody taps
  // through to /partner there is nearly always a session — it just isn't a
  // person. Reading that as "signed in but not linked yet" is what dropped
  // first-time visitors into the Register-your-business form without ever
  // asking who they were. A partner is somebody who deliberately signed in,
  // so an anonymous account is nobody as far as this side is concerned.
  if (user.is_anonymous) return { status: "signed-out" };

  const { data: link, error: linkError } = await supabase
    .from("partner_users")
    .select("partner_id, role, must_reset_password")
    .eq("user_id", user.id)
    .maybeSingle();

  if (linkError || !link) {
    const viaApple =
      user.app_metadata?.provider === "apple" ||
      (user.identities ?? []).some((i) => i.provider === "apple");
    return { status: "unlinked", email: user.email ?? null, viaApple };
  }

  // partner_name() and partner_photo_path() are SECURITY DEFINER on purpose
  // (see 006-my-bookings.sql, 015-my-bookings-partner-photo.sql): a partner's
  // own trading name and cover photo have to be visible to them even if the
  // catalogue's "approved partners are public" policy wouldn't otherwise
  // show it — say, on the day they're onboarded but not yet approved.
  const [{ data: name }, { data: photoPath }] = await Promise.all([
    supabase.rpc("partner_name", { p_partner_id: link.partner_id }),
    supabase.rpc("partner_photo_path", { p_partner_id: link.partner_id }),
  ]);

  return {
    status: "linked",
    session: {
      userId: user.id,
      partnerId: link.partner_id,
      partnerName: (name as string | null) ?? "Your business",
      partnerPhotoPath: (photoPath as string | null) ?? null,
      role: link.role === "owner" ? "owner" : "staff",
      mustResetPassword: link.must_reset_password === true,
    },
  };
});

/** Convenience for screens that only care whether there's a working session. */
export async function getPartnerSession(): Promise<PartnerSession | null> {
  const state = await getPartnerAuthState();
  return state.status === "linked" ? state.session : null;
}
