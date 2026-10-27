// Outbound transactional email, via Resend's HTTP API. No SDK dependency —
// it's a single POST, and that's all we need from the client. Server-only:
// RESEND_API_KEY must never reach the browser, so nothing here is exported
// as a Server Action and nothing here should be imported from client code.
//
// If RESEND_API_KEY isn't set (local dev without it configured), sends are
// skipped with a console warning rather than throwing — the things this
// currently backs (team invites) already have an in-app fallback and
// shouldn't fail just because email isn't wired up on this machine.

import { supabase } from "./supabase";

const FROM = "Andaman Go <support@andamango.in>";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://andamango.in";

// Brand color, kept in sync by hand with --color-brand in app/globals.css —
// email clients strip <style> blocks unpredictably enough that everything
// here is inline, so there's nothing to import from.
const BRAND = "#13434C";

// The real lockup (public/brand/, from the brand-logo-assets work), served
// from the live site so email clients — which never load local files — can
// fetch it. Falls back to plain text if SITE_URL isn't the real domain yet.
const LOGO_URL = `${SITE_URL}/brand/andaman-go-light-mode.png`;

/**
 * Table-based layout on purpose — Outlook desktop still renders emails with
 * Word's engine, which ignores flexbox/grid and mangles plain <div> spacing.
 * Every other client is fine with this too, so it's the one layout that
 * works everywhere rather than the best layout for anywhere.
 */
function emailShell(
  heading: string,
  bodyHtml: string,
  cta?: { label: string; url: string; footnote?: string },
): string {
  const button = cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 0;">
        <tr>
          <td bgcolor="${BRAND}" style="border-radius:8px;">
            <a href="${cta.url}" target="_blank"
               style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;
                      font-size:13.5px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">
              ${cta.label}
            </a>
          </td>
        </tr>
      </table>
      ${cta.footnote ? `<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#9A9F9C;">${cta.footnote}</p>` : ""}`
    : "";

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#EEEEEC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EEEEEC;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="460" cellpadding="0" cellspacing="0" style="max-width:460px;width:100%;">
            <tr>
              <td style="padding:0 2px 24px;">
                <img src="${LOGO_URL}" alt="Andaman Go" height="20" style="display:block;height:20px;width:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td bgcolor="#FFFFFF" style="border:1px solid #E3E3E0;border-radius:12px;padding:36px 32px;">
                <h1 style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;line-height:1.4;color:#181F1E;">
                  ${heading}
                </h1>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#54615D;">
                  ${bodyHtml}
                </div>
                ${button}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 2px 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#9A9F9C;">
                Andaman Go &nbsp;&middot;&nbsp; <a href="mailto:support@andamango.in" style="color:#9A9F9C;">support@andamango.in</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  // Resend fetches the file itself from `path` (must be publicly reachable) —
  // simpler and more robust than reading it off local disk and base64-ing it
  // here, and it's the same "let the email client fetch it" trick LOGO_URL
  // above already relies on.
  attachments?: { filename: string; path: string }[],
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`RESEND_API_KEY not set — skipping email "${subject}" to ${to}`);
    return false;
  }

  // Same 4s-timeout pattern as lib/stay-webhook.ts — without it, a hung
  // Resend call blocks whatever request triggered the send (a checkout, a
  // signup, or a whole settlement-cron loop of them) until the platform's
  // own function timeout kills it.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html, attachments }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`Resend send failed (${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend send threw:", err);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Sent when an owner adds someone to invite_partner_staff (026) — staff or backup owner. */
export async function sendTeamInviteEmail(
  to: string,
  partnerName: string,
  role: "owner" | "staff",
): Promise<boolean> {
  const loginUrl = `${SITE_URL}/partner/login`;
  const emailSubject =
    role === "owner"
      ? `${partnerName} added you as a backup owner on Andaman Go`
      : `${partnerName} invited you to their team on Andaman Go`;
  const heading =
    role === "owner"
      ? `You're now a backup owner for ${partnerName}`
      : `${partnerName} invited you to their team`;

  const body =
    role === "owner"
      ? `<p style="margin:0;"><strong>${partnerName}</strong> has added you as a backup owner. Sign in to Andaman Go to accept — you'll be able to reclaim the business from this account if you ever need to.</p>`
      : `<p style="margin:0;"><strong>${partnerName}</strong> would love to have you on their team. Sign in to Andaman Go and start helping with bookings and traveller check-ins.</p>`;

  const html = emailShell(heading, body, {
    label: "Sign in to accept",
    url: loginUrl,
    footnote: `Use the Google account this was sent to: ${to}`,
  });

  return sendEmail(to, emailSubject, html);
}

/** Sent once per partner: automatically right after register_partner (069)
 *  succeeds (registerPartner() in lib/partner-register.ts), and via the
 *  backfill on the admin Broadcasts page (lib/admin-broadcasts.ts). Content
 *  is the one broadcast_campaigns row with is_welcome_template = true (111)
 *  — raw HTML an admin edits directly in Broadcasts, not a structured
 *  in-code template (that editor was retired 2026-09-14; see
 *  lib/welcome-email-seed.ts for what it was seeded with). {{partner_name}}
 *  in either the subject or the HTML is replaced with the partner's
 *  business name — the only personalisation this supports. If no such row
 *  exists yet (admin hasn't set it up in Broadcasts), this no-ops rather
 *  than sending something broken. */
export async function sendPartnerWelcomeEmail(to: string, partnerName: string): Promise<boolean> {
  const { data } = await supabase
    .from("broadcast_campaigns")
    .select("subject, html")
    .eq("is_welcome_template", true)
    .maybeSingle();

  if (!data) {
    console.warn("No welcome campaign set up yet (Admin → Communications → Broadcasts) — skipping welcome email");
    return false;
  }

  const fill = (text: string) => text.replace(/\{\{partner_name\}\}/g, partnerName);
  return sendEmail(to, fill(data.subject), fill(data.html));
}

/** Sent once, right after ops onboards a partner on-site (see
 *  app/ops/partner-onboarding/cab/actions.ts): carries the "set your
 *  password" link for the login ops just created on the partner's behalf.
 *  Distinct from sendPartnerWelcomeEmail — that one is the admin-editable
 *  broadcast a partner gets after self-registering; this one is a
 *  functional link a partner needs before they can sign in at all. */
export async function sendPartnerOnboardingEmail(
  to: string,
  partnerName: string,
  setPasswordUrl: string,
): Promise<boolean> {
  const heading = "You're set up on Andaman Go";
  const body = `
    <p style="margin:0;">Hi ${partnerName},</p>
    <p style="margin:12px 0 0;">
      An Andaman Go team member has added <strong>${partnerName}</strong> to the platform. Your
      listing is saved and waiting for review — set a password to sign in and take a look.
    </p>`;

  return sendEmail(
    to,
    heading,
    emailShell(heading, body, {
      label: "Set your password",
      url: setPasswordUrl,
      footnote: "This link is for the account this email was sent to.",
    }),
  );
}

/** Sent once, right when an owner invites a staff member from Admin →
 *  Staff (139): carries the "set your password" link for the login that
 *  action just created, same shape as sendPartnerOnboardingEmail above and
 *  for the same reason — this account has never signed in before, so it
 *  needs a functional link, not the admin-editable welcome broadcast. */
export async function sendAdminStaffInviteEmail(to: string, setPasswordUrl: string): Promise<boolean> {
  const heading = "You've been added to the Andaman Go admin console";
  const body = `
    <p style="margin:0;">Hi,</p>
    <p style="margin:12px 0 0;">
      You've been given access to the Andaman Go admin console. Set a password to sign in and take
      a look.
    </p>`;

  return sendEmail(
    to,
    heading,
    emailShell(heading, body, {
      label: "Set your password",
      url: setPasswordUrl,
      footnote: "This link is for the account this email was sent to.",
    }),
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** In-code, not editable in Broadcasts — this is the one place a partner's
 *  own commission_bps is personalized into the send, which an admin-editable
 *  template can't compute. The attached PDF (public/partner-brochure.pdf,
 *  built by `npm run build:brochure` → scripts/build-partner-brochure.mjs)
 *  is the same file for every partner, so it deliberately carries no rate at
 *  all — just "commission is agreed individually with each business and
 *  shown in your dashboard," the same line the partner agreement and terms
 *  pages use. Only this email shows a specific number; regenerate the PDF
 *  only if its own wording changes, not when a rate changes. */
function firstListingEmailHtml(partnerName: string, commissionBps: number | null): string {
  const name = escapeHtml(partnerName);
  const dashboardUrl = `${SITE_URL}/partner`;
  const pct = commissionBps != null ? commissionBps / 100 : null;
  // A representative example only when a rate is actually on file — a
  // partner mid-registration with no commission_bps yet (137) sees the
  // general explanation without a specific number, rather than a wrong one.
  const exampleCommissionPaise = pct != null ? Math.round(100000 * (pct / 100)) : 0;
  const exampleShareRupees = pct != null ? (1000 - exampleCommissionPaise / 100).toFixed(0) : "0";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your Andaman Go Partner Guide</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f3;">
<div style="display:none;font-size:1px;color:#eef2f3;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
  Your partner guide is attached — listings, dashboard and the full commission table inside.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f3;">
<tr>
<td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:10px;overflow:hidden;">
    <tr>
      <td align="left" style="background-color:#0b3d3d;padding:26px 34px;">
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:19px;line-height:24px;font-weight:bold;color:#ffffff;letter-spacing:0.4px;">ANDAMAN&nbsp;GO</p>
        <p style="margin:5px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;color:#8fc4c4;letter-spacing:1.4px;text-transform:uppercase;">Partner Guide</p>
      </td>
    </tr>
    <tr>
      <td align="left" style="padding:34px 34px 0;">
        <h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:27px;line-height:35px;font-weight:bold;color:#12312f;">Your partner guide is attached</h1>
        <p style="margin:0 0 15px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3f4b4b;">Hello ${name},</p>
        <p style="margin:0 0 15px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3f4b4b;">
          Thanks for adding your first listing on Andaman Go. We've attached our Partner Guide, which
          walks through how listings, availability, check-in and settlements work &mdash; and sets out
          our commission rates in full, so there are no surprises at payout.
        </p>
        <p style="margin:0 0 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3f4b4b;">
          You set your own service price. Andaman Go earns a commission only on bookings made
          through the platform.
        </p>
      </td>
    </tr>
    <tr>
      <td align="left" style="padding:0 34px;">
        <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;font-weight:bold;color:#0b6b6b;letter-spacing:1.3px;text-transform:uppercase;">Your commission rate</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #dfe7e7;border-radius:8px;">
          <tr>
            <td style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#3f4b4b;">Agreed for your business</td>
            <td align="right" style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:19px;line-height:26px;font-weight:bold;color:#12312f;">${pct != null ? `${pct}%` : "Not set yet"}</td>
          </tr>
        </table>
        <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#788686;">
          Commission is negotiated with your business individually, not one fixed rate per category — this
          is the rate on file for you, and it&apos;s always shown in your dashboard.
        </p>
      </td>
    </tr>
    ${
      pct != null
        ? `<tr>
      <td align="left" style="padding:22px 34px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f8f8;border-radius:8px;">
          <tr><td style="padding:20px 18px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;font-weight:bold;color:#0b6b6b;letter-spacing:1.2px;text-transform:uppercase;">Example &mdash; a completed booking, at your rate</td></tr>
          <tr>
            <td style="padding:0 18px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="33%" align="center" style="padding:10px 6px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:19px;line-height:26px;font-weight:bold;color:#12312f;">INR 1,000</div>
                    <div style="font-size:12px;line-height:18px;color:#6a7878;">Booking value</div>
                  </td>
                  <td width="33%" align="center" style="padding:10px 6px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:19px;line-height:26px;font-weight:bold;color:#12312f;">&minus; INR ${(exampleCommissionPaise / 100).toFixed(0)}</div>
                    <div style="font-size:12px;line-height:18px;color:#6a7878;">${pct}% commission</div>
                  </td>
                  <td width="33%" align="center" style="padding:10px 6px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:19px;line-height:26px;font-weight:bold;color:#0b6b6b;">INR ${exampleShareRupees}</div>
                    <div style="font-size:12px;line-height:18px;color:#6a7878;">Your share</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#788686;">
          Partner share is shown before payment-processing fees, refunds, chargebacks or other applicable
          adjustments. Money you collect directly from the traveller forms part of your share, not an
          additional payout. Rental hotel-delivery add-ons are excluded from commission. Rates may change
          on reasonable notice; the rate in force when a booking is made is the rate that applies.
        </p>
      </td>
    </tr>`
        : ""
    }
    <tr>
      <td align="left" style="padding:28px 34px 0;">
        <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;font-weight:bold;color:#0b6b6b;letter-spacing:1.3px;text-transform:uppercase;">Good to know</p>
        <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3f4b4b;">
          <strong style="color:#12312f;">Partial payments.</strong> For cabs and stays taken on partial
          payment, the traveller pays the commission online and the balance directly to you.
        </p>
        <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3f4b4b;">
          <strong style="color:#12312f;">Settlements.</strong> For money held online, settlements deduct
          commission and any amounts you have already collected. Add your bank or UPI details in the
          dashboard and track each batch status there.
        </p>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3f4b4b;">
          <strong style="color:#12312f;">Your dashboard.</strong> Gross sales, commission and your share
          are shown for every booking, with monthly statements and CSV export.
        </p>
      </td>
    </tr>
    <tr>
      <td align="left" style="padding:30px 34px 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" bgcolor="#0b6b6b" style="border-radius:6px;">
              <a href="${dashboardUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">Open your partner dashboard</a>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3f4b4b;">
          If anything in the guide is unclear, or your category or rate looks different from what you
          expected, reply to this email and we will sort it out with you.
        </p>
        <p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3f4b4b;">
          Warm regards,<br>
          Partner Team, Andaman Go
        </p>
      </td>
    </tr>
    <tr>
      <td align="left" style="padding:26px 34px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #dfe7e7;border-radius:8px;">
          <tr>
            <td style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#3f4b4b;">
              <strong style="color:#12312f;">Attached:</strong> Andaman-Go-Partner-Brochure.pdf &nbsp;&middot;&nbsp; 5 pages
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="left" style="padding:30px 34px 34px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border-top:1px solid #e6ecec;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
        <p style="margin:18px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#6a7878;">
          <a href="mailto:partner@andamango.in" style="color:#0b6b6b;text-decoration:none;">partner@andamango.in</a>
          &nbsp;&middot;&nbsp;
          <a href="tel:+919476033302" style="color:#0b6b6b;text-decoration:none;">+91 94760 33302</a>
          &nbsp;&middot;&nbsp; 9:00&ndash;19:00 IST, all days
        </p>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#6a7878;">
          <a href="${dashboardUrl}" style="color:#0b6b6b;text-decoration:none;">${SITE_URL.replace(/^https?:\/\//, "")}/partner</a>
          &nbsp;&middot;&nbsp;
          <a href="${SITE_URL}/partner-agreement" style="color:#0b6b6b;text-decoration:none;">Partner agreement</a>
        </p>
      </td>
    </tr>
  </table>
</td>
</tr>
</table>
</body>
</html>`;
}

/** Sent once per partner: the first time they add ANY listing (any
 *  category), regardless of business/listing approval status — see
 *  maybeSendFirstListingEmail() in lib/partner-register.ts for the one-shot
 *  gate (partners.first_listing_email_sent, 119). Carries the commission
 *  guide PDF as an attachment; Resend fetches it directly from
 *  public/partner-brochure.pdf rather than this function reading it off
 *  disk, so it works the same in a serverless deploy as it does locally. */
export async function sendPartnerFirstListingEmail(
  to: string,
  partnerName: string,
  commissionBps: number | null,
): Promise<boolean> {
  return sendEmail(
    to,
    "Your Andaman Go partner guide is attached",
    firstListingEmailHtml(partnerName, commissionBps),
    [{ filename: "Andaman-Go-Partner-Brochure.pdf", path: `${SITE_URL}/partner-brochure.pdf` }],
  );
}

/** Raw send for the admin broadcast composer (lib/admin-broadcasts.ts, 109)
 *  — the admin supplies their own subject/HTML directly, no template or
 *  brand shell involved. Thin wrapper so sendEmail itself can stay
 *  unexported (every other export here builds its own HTML first). */
export async function sendCustomEmail(to: string, subject: string, html: string): Promise<boolean> {
  return sendEmail(to, subject, html);
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/** Sent right after run_settlement/run_settlement_cron (101/105) creates or
 *  updates a partner's batch for the week — the money isn't paid out yet
 *  (that's still a manual bank transfer an admin confirms), this is just the
 *  heads-up that it's been calculated and is queued. */
export async function sendSettlementReadyEmail(
  to: string,
  partnerName: string,
  batch: { periodStart: string; periodEnd: string; itemsSettled: number; netPayablePaise: number },
): Promise<boolean> {
  const period = `${dateLabel(batch.periodStart)} – ${dateLabel(batch.periodEnd)}`;
  const heading = `Your settlement for ${period} is ready`;
  const body = `
    <p style="margin:0;">Hi ${partnerName},</p>
    <p style="margin:12px 0 0;">
      This week's settlement has been calculated: <strong>${rupees(batch.netPayablePaise)}</strong>
      across <strong>${batch.itemsSettled}</strong> booking${batch.itemsSettled === 1 ? "" : "s"}, for ${period}.
    </p>
    <p style="margin:12px 0 0;">
      It'll be transferred to the bank/UPI details on file, and you'll get another email with the
      payment reference once it's sent.
    </p>`;

  return sendEmail(to, heading, emailShell(heading, body));
}

/** Sent right after mark_settlement_paid (101/105) confirms a bank transfer
 *  an admin just made outside the app — carries the actual reference so a
 *  partner can match it against their own bank statement. */
export async function sendSettlementPaidEmail(
  to: string,
  partnerName: string,
  batch: {
    periodStart: string;
    periodEnd: string;
    netPayablePaise: number;
    payoutReference: string;
  },
): Promise<boolean> {
  const period = `${dateLabel(batch.periodStart)} – ${dateLabel(batch.periodEnd)}`;
  const heading = `You've been paid ${rupees(batch.netPayablePaise)}`;
  const body = `
    <p style="margin:0;">Hi ${partnerName},</p>
    <p style="margin:12px 0 0;">
      <strong>${rupees(batch.netPayablePaise)}</strong> for your settlement covering ${period} has
      been sent to the bank/UPI details on file.
    </p>
    <p style="margin:12px 0 0;">
      Reference: <strong>${batch.payoutReference}</strong> — match this against your bank statement.
    </p>`;

  return sendEmail(to, heading, emailShell(heading, body));
}

/** Filed when someone taps "Delete my account" inside either app — App Store
 *  Review Guideline 5.1.1(v) requires that path to exist in-app, so this is
 *  what the button on /delete-account (and in partner Settings) actually
 *  does. Goes to the support inbox, not to the person requesting: they get
 *  an on-screen confirmation, and the 30-day commitment on the
 *  /delete-account page is what this has to be actioned against. See
 *  lib/account-deletion.ts. */
export async function sendAccountDeletionRequestEmail(req: {
  account: "traveller" | "partner";
  userId: string;
  email: string | null;
  phone: string | null;
  reason: string | null;
  requestedAt: string;
}): Promise<boolean> {
  const label = req.account === "partner" ? "Partner" : "Traveller";
  const heading = `${label} account deletion request`;

  const row = (k: string, v: string) =>
    `<tr>
       <td style="padding:5px 14px 5px 0;font-size:12px;color:#6b7c7b;white-space:nowrap;">${k}</td>
       <td style="padding:5px 0;font-size:13px;color:#0B2422;"><strong>${v}</strong></td>
     </tr>`;

  const body = `
    <p style="margin:0;">Someone asked to delete their ${label.toLowerCase()} account from inside the app.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0;">
      ${row("Account type", label)}
      ${row("User ID", req.userId)}
      ${row("Email", req.email ?? "—")}
      ${row("Phone", req.phone ?? "—")}
      ${row("Requested", req.requestedAt)}
    </table>
    ${
      req.reason
        ? `<p style="margin:18px 0 0;font-size:13px;">Reason given: “${req.reason}”</p>`
        : ""
    }
    <p style="margin:18px 0 0;font-size:13px;">
      /delete-account promises completion within 30 days. Booking and payment records
      tied to completed transactions are retained for the statutory period.
    </p>`;

  return sendEmail("support@andamango.in", heading, emailShell(heading, body));
}
