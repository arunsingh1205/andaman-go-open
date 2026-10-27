"use server";

// SMS OTP verification for a traveller's phone number, via Twilio Verify.
//
// Verify is a separate Twilio product from the Content Templates used for
// WhatsApp (lib/whatsapp.ts) — it works on a trial account with no funding
// and no template approval, since it's not sending template-category
// messages, just a one-off numeric code. TWILIO_VERIFY_SERVICE_SID is its
// own resource (a "Verify Service", SID starting with VA...), separate from
// TWILIO_WHATSAPP_FROM.
//
// Two calls, matching the two Twilio Verify endpoints:
//   sendPhoneOtp   — saves/normalises the number via set_my_phone (007), then
//                     asks Twilio to text it a code.
//   checkPhoneOtp  — asks Twilio whether the code matches, and if so, calls
//                     mark_my_phone_verified (115) to stamp verified_at.
//
// If Twilio env vars aren't set, both no-op with a clear message rather than
// throwing — same graceful-skip pattern as lib/email.ts and lib/whatsapp.ts.
//
// DEMO_PHONE / DEMO_OTP carve out one number that skips Twilio entirely and
// accepts a fixed code. This exists for App Store and Play review: reviewers
// sit outside India, cannot receive an Indian SMS, and an app they can't sign
// in to is rejected without further comment. Both vars must be set for the
// bypass to exist at all — unset either one (the default everywhere except
// production) and every number goes through Twilio as normal. Put the number
// and code in App Store Connect's App Review Information, and rotate DEMO_OTP
// after each review round.

import { supabaseServer } from "./supabase-server";

export type OtpResult = { ok: true; phone: string } | { ok: false; message: string };
export type CheckResult = { ok: true } | { ok: false; message: string };

/** The review-only number, if one is configured. Null unless BOTH vars are set. */
function demoLogin(): { phone: string; code: string } | null {
  const phone = process.env.DEMO_PHONE;
  const code = process.env.DEMO_OTP;
  if (!phone || !code) return null;
  return { phone, code };
}

function twilioConfigured(): { accountSid: string; authToken: string; serviceSid: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) return null;
  return { accountSid, authToken, serviceSid };
}

function authHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

/** Save + normalise the number (set_my_phone, 007), then text it a code. */
export async function sendPhoneOtp(phone: string): Promise<OtpResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_my_phone", { p_phone: phone });

  if (error) {
    if (error.message.includes("does not look like a phone number")) {
      return { ok: false, message: "That doesn't look right. A 10-digit mobile is enough." };
    }
    if (error.message.includes("not signed in")) {
      return { ok: false, message: "Reload the page and try again." };
    }
    return { ok: false, message: "Couldn't save that number. Try again." };
  }

  const clean = String(data);

  // Review bypass — no SMS is sent, and checkPhoneOtp() below accepts the
  // fixed code for this number only.
  const demo = demoLogin();
  if (demo && clean === demo.phone) {
    return { ok: true, phone: clean };
  }

  const config = twilioConfigured();
  if (!config) {
    console.warn("Twilio Verify not configured — skipping OTP send");
    return { ok: false, message: "Verification isn't switched on yet." };
  }

  try {
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${config.serviceSid}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader(config.accountSid, config.authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: clean, Channel: "sms" }),
      },
    );
    if (!res.ok) {
      console.error(`Twilio Verify send failed (${res.status}):`, await res.text());
      return { ok: false, message: "Couldn't send a code. Try again." };
    }
  } catch (err) {
    console.error("Twilio Verify send threw:", err);
    return { ok: false, message: "Couldn't send a code. Try again." };
  }

  return { ok: true, phone: clean };
}

/** Check the code Twilio texted, and if it matches, mark the number verified. */
export async function checkPhoneOtp(phone: string, code: string): Promise<CheckResult> {
  const demo = demoLogin();

  if (demo && phone === demo.phone) {
    // Review bypass: the fixed code, checked here, stands in for Twilio's
    // approval. Everything after this point is identical to a real verify.
    if (code !== demo.code) {
      return { ok: false, message: "That code didn't match." };
    }
  } else {
    const config = twilioConfigured();
    if (!config) {
      return { ok: false, message: "Verification isn't switched on yet." };
    }

    try {
      const res = await fetch(
        `https://verify.twilio.com/v2/Services/${config.serviceSid}/VerificationCheck`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader(config.accountSid, config.authToken),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: phone, Code: code }),
        },
      );
      if (!res.ok) {
        return { ok: false, message: "That code didn't work. Try again." };
      }
      const body = (await res.json()) as { status?: string };
      if (body.status !== "approved") {
        return { ok: false, message: "That code didn't match." };
      }
    } catch (err) {
      console.error("Twilio Verify check threw:", err);
      return { ok: false, message: "Couldn't check that code. Try again." };
    }
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("mark_my_phone_verified", { p_phone: phone });
  if (error) {
    return { ok: false, message: "Verified, but couldn't save it. Try again." };
  }

  return { ok: true };
}
