"use server";

// Broadcast emails to partners (109/111) — raw HTML composed by an admin,
// previewed, test-sent, then sent onward. Two shapes live here:
//   · one-off campaigns — admin-authored, admin-timed, locked once sent
//   · the partner welcome email — the one row with is_welcome_template =
//     true (111), always editable, read by lib/email.ts's
//     sendPartnerWelcomeEmail() for every automatic signup send and by this
//     file's own backfill for current partners
// Deliberately separate from lib/admin-communications.ts's notification_log:
// that's the automated transactional pipeline's delivery log (trigger/
// webhook driven); this file's sends are Node-direct, triggered by an admin
// clicking a button, not by a database trigger. RLS on broadcast_campaigns
// (is_admin() for everything except the welcome row's public SELECT) is the
// only gate — no RPC needed, same reasoning lib/admin-settlements.ts's
// plain-select reads already rely on.

import { supabaseServer } from "./supabase-server";
import { sendCustomEmail, sendPartnerWelcomeEmail, sendPartnerFirstListingEmail } from "./email";
import { sendPartnerWelcomeWhatsApp } from "./whatsapp";
import { recipientKindLabel, type PartnerKind } from "./partner-kind";
import { WELCOME_EMAIL_SEED_HTML, WELCOME_EMAIL_SEED_SUBJECT } from "./welcome-email-seed";

export type BroadcastCampaign = {
  id: string;
  name: string;
  subject: string;
  html: string;
  status: "draft" | "sent";
  /** null = every partner. A PartnerKind value narrows the send to just
   *  that category (110). */
  recipientKind: PartnerKind | null;
  recipientsSent: number;
  recipientsFailed: number;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  /** True only for the one standing welcome-email row (111) — lets a page
   *  that fetched a campaign by id notice it's actually the welcome
   *  template and redirect to its dedicated editor instead. */
  isWelcomeTemplate: boolean;
};

function fromRow(row: {
  id: string;
  name: string;
  subject: string;
  html: string;
  status: string;
  recipient_kind: string | null;
  recipients_sent: number;
  recipients_failed: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  is_welcome_template: boolean;
}): BroadcastCampaign {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    html: row.html,
    status: row.status as "draft" | "sent",
    recipientKind: (row.recipient_kind as PartnerKind | null) ?? null,
    recipientsSent: row.recipients_sent,
    recipientsFailed: row.recipients_failed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    isWelcomeTemplate: row.is_welcome_template,
  };
}

/** Excludes the welcome template (is_welcome_template = true) — it has its
 *  own page (getWelcomeCampaign, below) with substitution-aware send/backfill
 *  logic. Letting it appear here once meant it could be opened through the
 *  one-off editor and sent with "{{partner_name}}" literally in the subject
 *  — see sendBroadcastToAllPartners's own guard against the same thing. */
export async function listBroadcastCampaigns(): Promise<BroadcastCampaign[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("broadcast_campaigns")
    .select("*")
    .eq("is_welcome_template", false)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(fromRow);
}

export async function getBroadcastCampaign(id: string): Promise<BroadcastCampaign | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("broadcast_campaigns").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return fromRow(data);
}

export type BroadcastResult = { ok: boolean; message: string };

export async function createBroadcastCampaign(name: string): Promise<BroadcastResult & { id?: string }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("broadcast_campaigns")
    .insert({ name: name.trim() || "Untitled", subject: "", html: "" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "Couldn't create — you may need to be an admin." };
  return { ok: true, message: "Created.", id: data.id };
}

export async function saveBroadcastCampaign(
  id: string,
  fields: { name: string; subject: string; html: string; recipientKind: PartnerKind | null },
): Promise<BroadcastResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("broadcast_campaigns")
    .update({
      name: fields.name,
      subject: fields.subject,
      html: fields.html,
      recipient_kind: fields.recipientKind,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, message: "Couldn't save." };
  return { ok: true, message: "Saved." };
}

export async function deleteBroadcastCampaign(id: string): Promise<BroadcastResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("broadcast_campaigns").delete().eq("id", id).eq("status", "draft");
  if (error) return { ok: false, message: "Couldn't delete." };
  return { ok: true, message: "Deleted." };
}

/** Sends the given subject/HTML to exactly one address — the "send a test"
 *  button, before anyone else sees it. Uses whatever is currently in the
 *  editor, saved or not. */
export async function sendBroadcastTest(
  toEmail: string,
  subject: string,
  html: string,
): Promise<BroadcastResult> {
  const sent = await sendCustomEmail(toEmail, subject, html).catch(() => false);
  return sent
    ? { ok: true, message: `Test sent to ${toEmail}.` }
    : { ok: false, message: "Couldn't send the test. Try again." };
}

/** The real send — every partner with a resolvable owner email
 *  (admin_list_partner_owner_emails, 106). Sequential with a short pause
 *  between sends: at today's partner count (a few dozen) this finishes in
 *  seconds and stays well clear of Resend's rate limit, without needing a
 *  batching/queue system built for a scale this app isn't at yet. Marks the
 *  campaign 'sent' — a sent campaign can't be edited or re-sent from this
 *  screen, so a second click can't double-blast the same list; create a new
 *  campaign (copy the HTML) for a follow-up instead. */
export async function sendBroadcastToAllPartners(
  id: string,
): Promise<BroadcastResult & { sent: number; failed: number; total: number }> {
  const supabase = await supabaseServer();

  const { data: campaign } = await supabase.from("broadcast_campaigns").select("*").eq("id", id).maybeSingle();
  if (!campaign) return { ok: false, message: "Campaign not found.", sent: 0, failed: 0, total: 0 };
  if (campaign.is_welcome_template) {
    // The welcome template doesn't go through this path: it needs
    // {{partner_name}} substitution (sendPartnerWelcomeEmail) and idempotent
    // backfill semantics (skip already-welcomed partners), neither of which
    // this generic one-off sender does. Use the "Send now" button on the
    // Partner welcome email page instead.
    return {
      ok: false,
      message: "This is the welcome email template — use \"Send now\" on the Partner welcome email page instead.",
      sent: 0,
      failed: 0,
      total: 0,
    };
  }
  if (campaign.status === "sent") {
    return { ok: false, message: "This campaign has already been sent.", sent: 0, failed: 0, total: 0 };
  }
  if (!campaign.subject.trim() || !campaign.html.trim()) {
    return { ok: false, message: "Add a subject and HTML before sending.", sent: 0, failed: 0, total: 0 };
  }

  const { data: owners, error } = await supabase.rpc("admin_list_partner_owner_emails", {
    p_kind: campaign.recipient_kind,
  });
  if (error || !owners) {
    return { ok: false, message: "Couldn't load the partner list.", sent: 0, failed: 0, total: 0 };
  }
  const recipients = owners as { partner_id: string; partner_name: string; owner_email: string }[];

  let sent = 0;
  let failed = 0;
  for (const partner of recipients) {
    const ok = await sendCustomEmail(partner.owner_email, campaign.subject, campaign.html).catch(() => false);
    if (ok) sent++;
    else failed++;
    // A small pause between sends, not a real queue — fine at today's
    // partner count, see the function's own doc comment above.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  await supabase
    .from("broadcast_campaigns")
    .update({
      status: "sent",
      recipients_sent: sent,
      recipients_failed: failed,
      sent_at: new Date().toISOString(),
    })
    .eq("id", id);

  const audience = campaign.recipient_kind
    ? ` (${recipientKindLabel(campaign.recipient_kind as PartnerKind)})`
    : "";
  return {
    ok: true,
    message: `Sent to ${sent} of ${recipients.length} partner${recipients.length === 1 ? "" : "s"}${audience}${failed > 0 ? ` — ${failed} failed` : ""}.`,
    sent,
    failed,
    total: recipients.length,
  };
}

// ---------------------------------------------------------------------------
// The welcome email (111) — the one broadcast_campaigns row with
// is_welcome_template = true. Unlike an ordinary campaign above, this one:
//   · is never locked by status — it's a standing template, editable forever
//   · has its own "send" action: a backfill to partners who haven't had one
//     yet (idempotent, checked against notification_log), not a one-shot
//     blast to a fixed filtered list
//   · is what lib/email.ts::sendPartnerWelcomeEmail() actually reads, both
//     for the automatic send on signup and for this backfill
// ---------------------------------------------------------------------------

export async function getWelcomeCampaign(): Promise<BroadcastCampaign | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("broadcast_campaigns")
    .select("*")
    .eq("is_welcome_template", true)
    .maybeSingle();
  if (error || !data) return null;
  return fromRow(data);
}

/** First-time setup — seeds it with the last known-good design
 *  (lib/welcome-email-seed.ts, the retired structured template's final
 *  output) so nothing is lost; edit freely as raw HTML from there. */
export async function setUpWelcomeCampaign(): Promise<BroadcastResult & { id?: string }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("broadcast_campaigns")
    .insert({
      name: "Partner welcome email",
      subject: WELCOME_EMAIL_SEED_SUBJECT,
      html: WELCOME_EMAIL_SEED_HTML,
      is_welcome_template: true,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, message: "Couldn't set up the welcome email — you may need to be an admin." };
  }
  return { ok: true, message: "Set up.", id: data.id };
}

export async function saveWelcomeCampaign(
  id: string,
  fields: { subject: string; html: string },
): Promise<BroadcastResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("broadcast_campaigns")
    .update({ subject: fields.subject, html: fields.html, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("is_welcome_template", true);
  if (error) return { ok: false, message: "Couldn't save." };
  return { ok: true, message: "Saved." };
}

/** Every partner who hasn't had a 'sent' partner_welcome row *on that
 *  channel* yet (106) — checked per channel (email/whatsapp) rather than
 *  "has any welcome at all", so a partner who got the email welcome before
 *  WhatsApp went live (2026-09-16) and has since had a whatsapp_number added
 *  by an admin still gets the WhatsApp one here, without a duplicate email.
 *  Safe to click more than once. */
export async function backfillWelcomeCampaign(): Promise<BroadcastResult & { sent: number; total: number }> {
  const supabase = await supabaseServer();

  const { data: owners, error } = await supabase.rpc("admin_list_partner_owner_emails");
  if (error || !owners) return { ok: false, message: "Couldn't load the partner list.", sent: 0, total: 0 };
  const rows = owners as {
    partner_id: string;
    partner_name: string;
    owner_email: string | null;
    whatsapp_number: string | null;
  }[];

  const { data: already } = await supabase
    .from("notification_log")
    .select("partner_id, channel")
    .eq("kind", "partner_welcome")
    .eq("status", "sent");
  const welcomedEmail = new Set(
    (already ?? []).filter((r) => r.channel === "email").map((r) => r.partner_id as string),
  );
  const welcomedWhatsapp = new Set(
    (already ?? []).filter((r) => r.channel === "whatsapp").map((r) => r.partner_id as string),
  );

  type Job = { partner: (typeof rows)[number]; channel: "email" | "whatsapp" };
  const jobs: Job[] = [];
  for (const partner of rows) {
    if (partner.owner_email && !welcomedEmail.has(partner.partner_id)) {
      jobs.push({ partner, channel: "email" });
    }
    if (partner.whatsapp_number && !welcomedWhatsapp.has(partner.partner_id)) {
      jobs.push({ partner, channel: "whatsapp" });
    }
  }

  let sent = 0;
  for (const job of jobs) {
    const ok =
      job.channel === "email"
        ? await sendPartnerWelcomeEmail(job.partner.owner_email!, job.partner.partner_name).catch(() => false)
        : await sendPartnerWelcomeWhatsApp(job.partner.whatsapp_number!, job.partner.partner_name).catch(
            () => false,
          );
    await supabase.rpc("record_notification", {
      p_channel: job.channel,
      p_recipient_type: "partner",
      p_recipient_address: job.channel === "email" ? job.partner.owner_email : job.partner.whatsapp_number,
      p_kind: "partner_welcome",
      p_status: ok ? "sent" : "failed",
      p_payload: { partner_name: job.partner.partner_name },
      p_partner_id: job.partner.partner_id,
    });
    if (ok) sent++;
  }

  return {
    ok: true,
    message:
      jobs.length === 0
        ? "Every partner is already welcomed on every channel they have on file."
        : `Sent ${sent} of ${jobs.length} welcome message${jobs.length === 1 ? "" : "s"}.`,
    sent,
    total: jobs.length,
  };
}

// ---------------------------------------------------------------------------
// First-listing email (119/120) — unlike the welcome template above, this
// one's content lives in code (lib/email.ts::sendPartnerFirstListingEmail),
// because it's personalized with the recipient's own commission_bps, which
// an admin-editable template can't compute. So there's no editor here, just
// a test send and a backfill for partners who added a listing before 119
// shipped and so never triggered the automatic one.
// ---------------------------------------------------------------------------

/** The "send a test" button on the First-listing email admin page — always
 *  uses "Test Partner" as the name, same as the welcome email's test send. */
export async function sendFirstListingTest(toEmail: string): Promise<BroadcastResult> {
  // No real partner behind a test send — 3000 (30%) is only illustrative, so
  // the layout's example section renders with something in it.
  const sent = await sendPartnerFirstListingEmail(toEmail, "Test Partner", 3000).catch(() => false);
  return sent
    ? { ok: true, message: `Test sent to ${toEmail}.` }
    : { ok: false, message: "Couldn't send the test. Try again." };
}

/** Every partner who already added a listing before 119 shipped, so never
 *  triggered the automatic send, and hasn't had this email yet
 *  (admin_list_partners_needing_first_listing_email, 120). Claims each
 *  partner with the same conditional UPDATE the live path uses
 *  (maybeSendFirstListingEmail, lib/partner-register.ts) before sending, so
 *  this can't double-send against a partner who adds a brand-new listing
 *  (and gets the live send) while this backfill is still running. Safe to
 *  click more than once. */
export async function backfillFirstListingEmails(): Promise<BroadcastResult & { sent: number; total: number }> {
  const supabase = await supabaseServer();

  const { data: rows, error } = await supabase.rpc("admin_list_partners_needing_first_listing_email");
  if (error) {
    console.error("admin_list_partners_needing_first_listing_email failed:", error);
    return { ok: false, message: `Couldn't load the partner list: ${error.message}`, sent: 0, total: 0 };
  }
  const partners = (rows ?? []) as { partner_id: string; partner_name: string; owner_email: string }[];

  if (partners.length === 0) {
    // Genuinely nothing to do — nobody with an unsent flag has a
    // qualifying listing yet, as opposed to candidates existing but every
    // claim call below failing (which is a bug, not a no-op — see the
    // "found N but claimed 0" branch further down).
    return { ok: true, message: "No partner currently qualifies — none have an unsent flag with a listing on file.", sent: 0, total: 0 };
  }

  let sent = 0;
  let claimedCount = 0;
  let claimErrors = 0;
  for (const partner of partners) {
    // partners has no RLS UPDATE policy — this must go through the
    // claim_first_listing_email RPC (121), not a raw table update (which
    // silently no-ops under RLS rather than erroring; that's what the first
    // run of this backfill hit).
    const { data: claimed, error: claimError } = await supabase.rpc("claim_first_listing_email", {
      p_partner_id: partner.partner_id,
    });
    if (claimError) {
      console.error(`claim_first_listing_email failed for ${partner.partner_id}:`, claimError);
      claimErrors++;
      continue;
    }
    if (!claimed) continue;
    claimedCount++;

    const { data: partnerRow } = await supabase
      .from("partners")
      .select("commission_bps")
      .eq("id", partner.partner_id)
      .maybeSingle();

    const ok = await sendPartnerFirstListingEmail(
      partner.owner_email,
      partner.partner_name,
      partnerRow?.commission_bps ?? null,
    ).catch(() => false);
    await supabase.rpc("record_notification", {
      p_channel: "email",
      p_recipient_type: "partner",
      p_recipient_address: partner.owner_email,
      p_kind: "first_listing",
      p_status: ok ? "sent" : "failed",
      p_payload: { partner_name: partner.partner_name },
      p_partner_id: partner.partner_id,
    });
    if (ok) sent++;
    // Same pacing as sendBroadcastToAllPartners — a real pause, not a queue,
    // fine at today's partner count.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  if (claimedCount === 0) {
    return {
      ok: claimErrors === 0,
      message:
        claimErrors > 0
          ? `Found ${partners.length} partner${partners.length === 1 ? "" : "s"} but couldn't claim any (${claimErrors} error${claimErrors === 1 ? "" : "s"} — check server logs).`
          : "Every candidate was already claimed by something else (likely a concurrent send) — nothing to do.",
      sent: 0,
      total: 0,
    };
  }

  return {
    ok: true,
    message: `Sent ${sent} of ${claimedCount} first-listing email${claimedCount === 1 ? "" : "s"}.`,
    sent,
    total: claimedCount,
  };
}
