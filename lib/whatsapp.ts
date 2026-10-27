// Outbound transactional WhatsApp, via Twilio's WhatsApp Business API. Same
// shape as lib/email.ts: raw fetch, no SDK, server-only — TWILIO_AUTH_TOKEN
// must never reach the browser, so nothing here is exported as a Server
// Action and nothing here should be imported from client code.
//
// This only covers the two sends that are already Node-triggered right after
// an RPC succeeds (welcome, settlement) — same reasoning lib/email.ts's
// settlement senders are Node-direct rather than going through a trigger.
// Booking-notification WhatsApp (to both partner and customer) goes through
// a different path: notify_booking_comms() (106) queues a row, and
// supabase/functions/send-notification sends it — see that function's own
// Twilio branch, which duplicates the low-level send call below since Deno
// can't import this file.
//
// A proactive WhatsApp message outside a 24-hour customer-service window
// requires a pre-approved Content Template (Meta/WhatsApp platform rule,
// enforced by Twilio too) — every function here takes a template SID, never
// free-form text.
//
// If Twilio env vars aren't set (no account yet, or templates still pending
// approval), sends are skipped with a console warning rather than throwing —
// identical to sendEmail's RESEND_API_KEY-unset fallback, so nothing has to
// special-case "WhatsApp isn't live yet."

const FROM = process.env.TWILIO_WHATSAPP_FROM;

async function sendWhatsApp(
  to: string,
  templateSid: string,
  variables: Record<string, string>,
): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken || !FROM) {
    console.warn(`Twilio not configured — skipping WhatsApp template ${templateSid} to ${to}`);
    return false;
  }

  // Same 4s-timeout pattern as lib/stay-webhook.ts and lib/email.ts —
  // without it, a hung Twilio call blocks whatever triggered the send.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: `whatsapp:${FROM}`,
        To: `whatsapp:${to}`,
        ContentSid: templateSid,
        ContentVariables: JSON.stringify(variables),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`Twilio send failed (${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Twilio send threw:", err);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Sent once per partner, right alongside sendPartnerWelcomeEmail. */
export async function sendPartnerWelcomeWhatsApp(to: string, partnerName: string): Promise<boolean> {
  const templateSid = process.env.TWILIO_TEMPLATE_PARTNER_WELCOME;
  if (!templateSid) {
    console.warn("TWILIO_TEMPLATE_PARTNER_WELCOME not set — skipping welcome WhatsApp");
    return false;
  }
  return sendWhatsApp(to, templateSid, { "1": partnerName });
}

/** Sent right alongside sendPartnerOnboardingEmail, when ops onboards a
 *  partner on-site. Needs its own Meta-approved template
 *  (TWILIO_TEMPLATE_PARTNER_ONBOARDING) carrying the partner name and the
 *  set-password link as its two variables — not yet created as of this
 *  writing, so this no-ops with a console warning until it is; email
 *  carries the flow until then. */
export async function sendPartnerOnboardingWhatsApp(
  to: string,
  partnerName: string,
  setPasswordUrl: string,
): Promise<boolean> {
  const templateSid = process.env.TWILIO_TEMPLATE_PARTNER_ONBOARDING;
  if (!templateSid) {
    console.warn("TWILIO_TEMPLATE_PARTNER_ONBOARDING not set — skipping onboarding WhatsApp");
    return false;
  }
  return sendWhatsApp(to, templateSid, { "1": partnerName, "2": setPasswordUrl });
}

/** Sent right alongside sendSettlementReadyEmail (105). */
export async function sendSettlementReadyWhatsApp(
  to: string,
  partnerName: string,
  batch: { itemsSettled: number; netPayablePaise: number },
): Promise<boolean> {
  const templateSid = process.env.TWILIO_TEMPLATE_SETTLEMENT_READY;
  if (!templateSid) {
    console.warn("TWILIO_TEMPLATE_SETTLEMENT_READY not set — skipping settlement-ready WhatsApp");
    return false;
  }
  return sendWhatsApp(to, templateSid, {
    "1": partnerName,
    "2": `₹${(batch.netPayablePaise / 100).toLocaleString("en-IN")}`,
    "3": String(batch.itemsSettled),
  });
}

/** Sent right alongside sendSettlementPaidEmail (105). */
export async function sendSettlementPaidWhatsApp(
  to: string,
  partnerName: string,
  batch: { netPayablePaise: number; payoutReference: string },
): Promise<boolean> {
  const templateSid = process.env.TWILIO_TEMPLATE_SETTLEMENT_PAID;
  if (!templateSid) {
    console.warn("TWILIO_TEMPLATE_SETTLEMENT_PAID not set — skipping settlement-paid WhatsApp");
    return false;
  }
  return sendWhatsApp(to, templateSid, {
    "1": partnerName,
    "2": `₹${(batch.netPayablePaise / 100).toLocaleString("en-IN")}`,
    "3": batch.payoutReference,
  });
}
