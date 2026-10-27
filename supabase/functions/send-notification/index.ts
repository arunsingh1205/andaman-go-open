// Generic dispatcher for notification_log (106): a Supabase Database Webhook
// (configured in the dashboard, not SQL — same manual step as 094's
// send-partner-push) fires this on every insert into notification_log, and
// it sends the row via Resend (email), Twilio WhatsApp (whatsapp), or
// Firebase FCM (push — added 126, same HTTP v1 + service-account JWT flow
// send-partner-push already uses, just reusing this shared table instead of
// a separate one — there's no customer-facing in-app feed to hang push off
// the way partner_notifications does for partners), then writes the result
// back onto the row.
//
// notification_log gets inserted into from three different places, and this
// function must only ever act on the two "pending" ones:
//   · notify_booking_comms() (106), a trigger — inserts 'pending' rows meant
//     to be sent right now. This function sends those.
//   · notify_booking_state_change() (126), a second trigger — same shape,
//     for a booking's state changing after it's created (confirmed/
//     disrupted/refunded) rather than the moment it's made.
//   · record_notification() (106), called Node-side right after
//     lib/email.ts / lib/whatsapp.ts already sent a welcome or settlement
//     message directly — those rows land already 'sent' or 'failed', purely
//     as a log entry. This function must ignore them, or it would try to
//     send an already-sent message a second time.
// admin_resend_notification() (106) inserts a fresh 'pending' row for ANY
// kind (not just booking_new) when an admin clicks "Resend" on the
// Communications page — that's how a resend of a welcome/settlement message
// also flows through here rather than back through Node. The one exception
// is first_listing (119): it carries a large commission-table email and a
// static PDF, already fully implemented in lib/email.ts, so duplicating it
// here just for the rare failed-resend case isn't worth two copies staying
// in sync — buildEmail() returns null for it and the row is marked failed
// with a message pointing at the admin Broadcasts backfill instead, which
// calls that same lib/email.ts function directly.
//
// Deploy: `supabase functions deploy send-notification`
// Secrets it needs (`supabase secrets set NAME=value`):
//   RESEND_API_KEY                — same key lib/email.ts uses
//   SITE_URL                      — e.g. https://andamango.in (falls back if unset)
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM
//   TWILIO_TEMPLATE_BOOKING_PARTNER    — Content SID, booking_new -> partner
//   TWILIO_TEMPLATE_BOOKING_CUSTOMER   — Content SID, booking_new -> customer
//   TWILIO_TEMPLATE_PARTNER_WELCOME
//   TWILIO_TEMPLATE_SETTLEMENT_READY
//   TWILIO_TEMPLATE_SETTLEMENT_PAID
//   TWILIO_TEMPLATE_BOOKING_CONFIRMED  — Content SID, booking_confirmed (126)
//   TWILIO_TEMPLATE_BOOKING_DISRUPTED  — Content SID, booking_disrupted (126)
//   TWILIO_TEMPLATE_BOOKING_REFUNDED   — Content SID, booking_refunded (126)
//     (all three are new Meta-approved WhatsApp templates that don't exist
//     yet — until they're created and their SIDs set, a 'whatsapp' row for
//     these kinds just fails with a clear "not set" error; email and push
//     for the same event still go out fine, since each channel is its own
//     row)
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
//     — same three values send-partner-push already uses (one Firebase
//     project can back both apps' push — see that function's header comment
//     for where these come from). Without them, a 'push' row fails with a
//     clear "not set" error the same way a missing Twilio/Resend key does.
//   NOTIFICATION_WEBHOOK_SECRET    — checked against the webhook's custom header
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already present in every
// Edge Function's environment automatically.
//
// Wiring the trigger (dashboard, not SQL): Database -> Webhooks -> Create a
// new hook -> table notification_log -> Insert -> HTTP request to this
// function's URL -> add header "x-webhook-secret" set to the same value as
// NOTIFICATION_WEBHOOK_SECRET above.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

type NotificationRow = {
  id: string;
  channel: "email" | "whatsapp" | "push";
  recipient_type: "partner" | "customer";
  // The email address, phone number, or (for channel 'push') the FCM device
  // token to send to — recipient_address is overloaded the same way across
  // all three channels, one row per actual message.
  recipient_address: string;
  kind:
    | "partner_welcome"
    | "booking_new"
    | "settlement_ready"
    | "settlement_paid"
    | "first_listing"
    | "booking_confirmed"
    | "booking_disrupted"
    | "booking_refunded";
  status: "pending" | "sent" | "failed";
  // deno-lint-ignore no-explicit-any
  payload: Record<string, any>;
};

type WebhookPayload = {
  type: string;
  table: string;
  record: NotificationRow;
};

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://andamango.in";
const FROM = "Andaman Go <support@andamango.in>";
const BRAND = "#13434C";
const LOGO_URL = `${SITE_URL}/brand/andaman-go-light-mode.png`;

// Same brand palette as lib/welcome-email-seed.ts's design — reused here for
// the booking notification card, the other place (besides the welcome
// email) that earns a branded look rather than the plain emailShell().
const BRAND_SOFT = "#E4F0EE";
const BRAND_MINT = "#7FD1C5";
const GO_TEAL = "#52A6A8";
const LOGO_DARK_URL = `${SITE_URL}/brand/andaman-go-dark-mode.png`;
const DARK_BG = "#0E1A18";
const DARK_SURFACE = "#173C3B";
const DARK_SURFACE_TEXT = "#F2F6F5";
const DARK_SURFACE_MUTED = "#AFC9C6";
const DARK_MUTED = "#8CA39F";

// ---------------------------------------------------------------------------
// QR encoding — a verbatim port of lib/qr.ts's qrMatrix() (versions 1-4,
// error-correction level L). Deno can't import that Next.js module, but the
// function itself is pure/dependency-free JS (no DOM, no Node APIs), so it
// runs here unmodified. Reusing it — rather than a different encoder or an
// external QR API — means the PDF ticket's QR is generated exactly the same
// way as the one already shown on the booking-confirmation page
// (app/booked/page.tsx) and the bookings list (app/bookings/page.tsx). Keep
// all three in sync by hand if this ever needs to change.
// ---------------------------------------------------------------------------

const QR_EXP = new Uint8Array(512);
const QR_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    QR_EXP[i] = x;
    QR_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) QR_EXP[i] = QR_EXP[i - 255];
})();

function qrMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return QR_EXP[QR_LOG[a] + QR_LOG[b]];
}

function qrGenerator(degree: number): number[] {
  let poly = [1];
  for (let d = 0; d < degree; d++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];
      next[i + 1] ^= qrMul(poly[i], QR_EXP[d]);
    }
    poly = next;
  }
  return poly;
}

function qrErrorCorrection(data: number[], count: number): number[] {
  const gen = qrGenerator(count);
  const rest = [...data, ...new Array<number>(count).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = rest[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) rest[i + j] ^= qrMul(gen[j], factor);
  }
  return rest.slice(data.length);
}

type QrVersion = { version: number; size: number; data: number; ec: number; align: number[] };
const QR_VERSIONS: QrVersion[] = [
  { version: 1, size: 21, data: 19, ec: 7, align: [] },
  { version: 2, size: 25, data: 34, ec: 10, align: [6, 18] },
  { version: 3, size: 29, data: 55, ec: 15, align: [6, 22] },
  { version: 4, size: 33, data: 80, ec: 20, align: [6, 26] },
];

type QrGrid = { size: number; on: boolean[][]; fixed: boolean[][] };

function qrBlank(size: number): QrGrid {
  return {
    size,
    on: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    fixed: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function qrPlace(g: QrGrid, row: number, col: number, on: boolean) {
  if (row < 0 || col < 0 || row >= g.size || col >= g.size) return;
  g.on[row][col] = on;
  g.fixed[row][col] = true;
}

function qrFinder(g: QrGrid, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const ring = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
      qrPlace(g, row + r, col + c, inner || ring);
    }
  }
}

function qrSkeleton(g: QrGrid, v: QrVersion) {
  const n = g.size;
  qrFinder(g, 0, 0);
  qrFinder(g, 0, n - 7);
  qrFinder(g, n - 7, 0);
  for (let i = 8; i < n - 8; i++) {
    qrPlace(g, 6, i, i % 2 === 0);
    qrPlace(g, i, 6, i % 2 === 0);
  }
  if (v.align.length) {
    const centre = v.align[1];
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const on = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        qrPlace(g, centre + r, centre + c, on);
      }
    }
  }
  qrPlace(g, n - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      g.fixed[8][i] = true;
      g.fixed[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    g.fixed[8][n - 1 - i] = true;
    g.fixed[n - 1 - i][8] = true;
  }
}

function qrWriteData(g: QrGrid, bits: number[]) {
  let i = 0;
  let upward = true;
  for (let right = g.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < g.size; step++) {
      const row = upward ? g.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (g.fixed[row][col]) continue;
        g.on[row][col] = i < bits.length && bits[i] === 1;
        i++;
      }
    }
    upward = !upward;
  }
}

const QR_MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function qrWriteFormat(g: QrGrid, mask: number) {
  const n = g.size;
  const value = 0b01000 | mask;
  let bch = value << 10;
  for (let i = 4; i >= 0; i--) {
    if (bch & (1 << (i + 10))) bch ^= 0b10100110111 << i;
  }
  const bits = ((value << 10) | bch) ^ 0b101010000010010;
  const at = (i: number) => ((bits >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) qrPlace(g, i, 8, at(i));
  qrPlace(g, 7, 8, at(6));
  qrPlace(g, 8, 8, at(7));
  qrPlace(g, 8, 7, at(8));
  for (let i = 9; i <= 14; i++) qrPlace(g, 8, 14 - i, at(i));
  for (let i = 0; i <= 7; i++) qrPlace(g, 8, n - 1 - i, at(i));
  for (let i = 8; i <= 14; i++) qrPlace(g, n - 15 + i, 8, at(i));
}

function qrPenalty(on: boolean[][]): number {
  const n = on.length;
  let score = 0;
  const runs = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        if (get(a, b) === get(a, b - 1)) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  };
  runs((r, c) => on[r][c]);
  runs((c, r) => on[r][c]);
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = on[r][c];
      if (v === on[r][c + 1] && v === on[r + 1][c] && v === on[r + 1][c + 1]) score += 3;
    }
  }
  const bad = [true, false, true, true, true, false, true, false, false, false, false];
  const matches = (cells: boolean[]) => {
    for (let i = 0; i + bad.length <= cells.length; i++) {
      let hit = true;
      for (let j = 0; j < bad.length; j++) {
        if (cells[i + j] !== bad[j]) { hit = false; break; }
      }
      if (hit) score += 40;
      let hitR = true;
      for (let j = 0; j < bad.length; j++) {
        if (cells[i + j] !== bad[bad.length - 1 - j]) { hitR = false; break; }
      }
      if (hitR) score += 40;
    }
  };
  for (let i = 0; i < n; i++) {
    matches(on[i]);
    matches(on.map((row) => row[i]));
  }
  let dark = 0;
  for (const row of on) for (const cell of row) if (cell) dark++;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/** The QR grid for `text`, as rows of booleans. Throws if too long (max ~78
 *  chars at this encoder's level-L/version-4 ceiling — well clear of the
 *  ticket URLs this is actually used for). */
function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const v = QR_VERSIONS.find((candidate) => bytes.length + 2 <= candidate.data);
  if (!v) throw new Error(`qrMatrix: "${text.slice(0, 20)}…" is too long for this encoder`);

  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, v.data * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let i = 0; data.length < v.data; i++) data.push(i % 2 === 0 ? 0xec : 0x11);

  const codewords = [...data, ...qrErrorCorrection(data, v.ec)];
  const stream: number[] = [];
  for (const word of codewords) for (let i = 7; i >= 0; i--) stream.push((word >> i) & 1);

  const base = qrBlank(v.size);
  qrSkeleton(base, v);
  qrWriteData(base, stream);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g: QrGrid = {
      size: v.size,
      on: base.on.map((row) => [...row]),
      fixed: base.fixed.map((row) => [...row]),
    };
    for (let r = 0; r < g.size; r++) {
      for (let c = 0; c < g.size; c++) {
        if (!g.fixed[r][c] && QR_MASKS[mask](r, c)) g.on[r][c] = !g.on[r][c];
      }
    }
    qrWriteFormat(g, mask);
    const score = qrPenalty(g.on);
    if (score < bestScore) {
      bestScore = score;
      best = g.on;
    }
  }
  return best!;
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Trimmed-down twin of lib/email.ts's emailShell() — Deno can't import a
// Next.js module, so the brand wrapper is duplicated here. Keep the two in
// sync by hand if the look ever changes.
function emailShell(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 0;"><tr>
         <td bgcolor="${BRAND}" style="border-radius:8px;">
           <a href="${cta.url}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${cta.label}</a>
         </td></tr></table>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background-color:#EEEEEC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EEEEEC;padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="460" cellpadding="0" cellspacing="0" style="max-width:460px;width:100%;">
      <tr><td bgcolor="#FFFFFF" style="border:1px solid #E3E3E0;border-radius:12px;padding:36px 32px;">
        <h1 style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#181F1E;">${heading}</h1>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#54615D;">${bodyHtml}</div>
        ${button}
      </td></tr>
      <tr><td style="padding:24px 2px 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#9A9F9C;">
        Andaman Go &nbsp;&middot;&nbsp; <a href="mailto:support@andamango.in" style="color:#9A9F9C;">support@andamango.in</a>
      </td></tr>
    </table></td></tr></table></body></html>`;
}

/**
 * The booking notification — a compact branded card (not the full
 * marketing-style welcome email, just the logo + a colour hero + a CTA),
 * for both the partner and customer variants of booking_new. Same visual
 * language as the welcome email (brand colours, logo light/dark swap,
 * prefers-color-scheme support) but code-built, not admin-edited: unlike
 * the welcome email, this has real per-booking data (title/when/party/name)
 * that has to be injected live, so a single static HTML blob with
 * find-and-replace tags doesn't fit the same way it does for a one-time
 * evergreen welcome message.
 */
function bookingEmailHtml(
  variant: "partner" | "customer",
  fields: { title: string; when: string; party?: string; name?: string; ticketCode?: string | null },
): string {
  const badge = variant === "partner" ? "New booking" : "You&rsquo;re in";
  const heading = fields.title;
  const subheading = variant === "partner" ? `${fields.when} · ${fields.party}` : fields.when;
  const message =
    variant === "partner"
      ? "A new booking just landed — open the Bookings tab for guest contact details."
      : fields.ticketCode
        ? `Hi ${fields.name ?? "there"}, you&rsquo;re all set — your e-ticket is attached as a PDF. Show the QR code at check-in.`
        : `Hi ${fields.name ?? "there"}, you&rsquo;re all set for this booking. See you then!`;
  const ctaLabel = variant === "partner" ? "Open dashboard" : "View my bookings";
  const ctaUrl = variant === "partner" ? `${SITE_URL}/partner/login` : `${SITE_URL}/bookings`;

  const styleBlock = `
    <style>
      @media (prefers-color-scheme: dark) {
        .eaf-bg { background-color:${DARK_BG} !important; }
        .eaf-surface { background-color:${DARK_SURFACE} !important; }
        .eaf-surface-text { color:${DARK_SURFACE_TEXT} !important; }
        .eaf-surface-muted { color:${DARK_SURFACE_MUTED} !important; }
        .eaf-muted { color:${DARK_MUTED} !important; }
        .eaf-logo-light { display:none !important; }
        .eaf-logo-dark { display:block !important; }
      }
    </style>`;

  return `
<!doctype html>
<html>
  <head>
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    ${styleBlock}
  </head>
  <body class="eaf-bg" style="margin:0;padding:0;background-color:#EEEEEC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="eaf-bg" style="background-color:#EEEEEC;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">

          <tr><td style="padding:0 4px 18px;">
            <img src="${LOGO_URL}" alt="Andaman Go" height="20" class="eaf-logo-light" style="display:block;height:20px;width:auto;border:0;" />
            <img src="${LOGO_DARK_URL}" alt="Andaman Go" height="20" class="eaf-logo-dark" style="display:none;height:20px;width:auto;border:0;" />
          </td></tr>

          <tr><td bgcolor="${BRAND_SOFT}" class="eaf-surface" style="border-radius:16px 16px 0 0;padding:28px 26px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td bgcolor="${BRAND}" style="border-radius:999px;padding:5px 12px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;font-weight:bold;letter-spacing:0.08em;color:#FFFFFF;text-transform:uppercase;">${badge}</span>
              </td>
            </tr></table>
            <p class="eaf-surface-text" style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;font-weight:bold;color:${BRAND};">${heading}</p>
            <p class="eaf-surface-muted" style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.5;color:#54615D;">${subheading}</p>
            ${
              fields.ticketCode
                ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>
                     <td bgcolor="#FFFFFF" style="border:1px dashed #C9DCDA;border-radius:8px;padding:8px 14px;">
                       <span style="font-family:'Courier New',Courier,monospace;font-size:13px;font-weight:bold;letter-spacing:0.04em;color:${BRAND};">${fields.ticketCode}</span>
                     </td>
                   </tr></table>`
                : ""
            }
          </td></tr>

          <tr><td bgcolor="${BRAND}" style="border-radius:0 0 16px 16px;padding:20px 26px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#FFFFFF;">${message}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr>
              <td bgcolor="${GO_TEAL}" style="border-radius:999px;">
                <a href="${ctaUrl}" target="_blank"
                   style="display:inline-block;padding:11px 20px;font-family:Arial,Helvetica,sans-serif;
                          font-size:13px;font-weight:bold;color:#FFFFFF;text-decoration:none;white-space:nowrap;">
                  ${ctaLabel} &rarr;
                </a>
              </td>
            </tr></table>
          </td></tr>

          <tr><td style="height:18px;"></td></tr>

          <tr><td class="eaf-muted" style="padding:0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9A9F9C;">
            Questions? <a href="mailto:support@andamango.in" style="color:#9A9F9C;">support@andamango.in</a>
            &nbsp;&middot;&nbsp; Andaman Go, Port Blair, Andaman &amp; Nicobar Islands 744101
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** Same "https://andamango.app/t/<code>" scheme app/booked/page.tsx and
 *  app/bookings/page.tsx already encode into the QR shown in-app — kept
 *  identical here so a partner's `normalise_code()` (005) resolves either
 *  QR, from the app or from this PDF, to the same booking. */
function ticketQrUrl(ticketCode: string): string {
  return `https://andamango.app/t/${ticketCode}`;
}

// deno-lint-ignore no-explicit-any
function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A one-page PDF e-ticket: brand header, booking title/time, the ticket code
 * as text, and its QR drawn directly from qrMatrix() as filled rectangles —
 * no raster image step, no external QR service. Only built for the customer
 * side, and only when a ticket_code already exists (113) — ferry and
 * rate-card-cab bookings don't have one yet at insert time, so those just
 * get the plain card email with no attachment, same as before this feature.
 */
async function buildTicketPdf(fields: { title: string; when: string; ticketCode: string }): Promise<Uint8Array> {
  const pageWidth = 320;
  const pageHeight = 480;
  const doc = await PDFDocument.create();
  const page = doc.addPage([pageWidth, pageHeight]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const brand = rgb(0x13 / 255, 0x43 / 255, 0x4c / 255);
  const goTeal = rgb(0x52 / 255, 0xa6 / 255, 0xa8 / 255);
  const muted = rgb(0x54 / 255, 0x61 / 255, 0x5d / 255);
  const white = rgb(1, 1, 1);
  const line = rgb(0.85, 0.88, 0.87);

  // Header band.
  const headerHeight = 90;
  page.drawRectangle({ x: 0, y: pageHeight - headerHeight, width: pageWidth, height: headerHeight, color: brand });
  page.drawText("Andaman Go", { x: 24, y: pageHeight - 44, size: 19, font: bold, color: white });
  page.drawText("E-TICKET", { x: 24, y: pageHeight - 68, size: 10, font: bold, color: goTeal });

  // Title (wrapped up to 2 lines) + when.
  const contentWidth = pageWidth - 48;
  const titleLines = wrapText(fields.title, bold, 15, contentWidth).slice(0, 2);
  let y = pageHeight - headerHeight - 34;
  for (const l of titleLines) {
    page.drawText(l, { x: 24, y, size: 15, font: bold, color: brand });
    y -= 19;
  }
  y -= 4;
  page.drawText(fields.when, { x: 24, y, size: 11, font: regular, color: muted });
  y -= 18;
  page.drawLine({ start: { x: 24, y }, end: { x: pageWidth - 24, y }, thickness: 0.75, color: line });

  // QR, centred, drawn as filled squares straight from the module grid.
  const qrUrl = ticketQrUrl(fields.ticketCode);
  const grid = qrMatrix(qrUrl);
  const qrSize = 200;
  const moduleSize = qrSize / grid.length;
  const qrX = (pageWidth - qrSize) / 2;
  const qrTop = y - 20;
  const qrY = qrTop - qrSize;
  page.drawRectangle({ x: qrX - 8, y: qrY - 8, width: qrSize + 16, height: qrSize + 16, color: white });
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      if (!grid[r][c]) continue;
      page.drawRectangle({
        x: qrX + c * moduleSize,
        y: qrTop - (r + 1) * moduleSize,
        width: moduleSize,
        height: moduleSize,
        color: rgb(0, 0, 0),
      });
    }
  }

  // Ticket code, centred, below the QR.
  const codeSize = 14;
  const codeWidth = bold.widthOfTextAtSize(fields.ticketCode, codeSize);
  page.drawText(fields.ticketCode, {
    x: (pageWidth - codeWidth) / 2,
    y: qrY - 28,
    size: codeSize,
    font: bold,
    color: brand,
  });

  // Footer.
  const footer = "Show this at check-in · support@andamango.in";
  const footerSize = 8;
  const footerWidth = regular.widthOfTextAtSize(footer, footerSize);
  page.drawText(footer, {
    x: (pageWidth - footerWidth) / 2,
    y: 24,
    size: footerSize,
    font: regular,
    color: muted,
  });

  return doc.save();
}

/** Reads the welcome email's content — the one broadcast_campaigns row
 *  (109/111) with is_welcome_template = true, admin-edited as raw HTML on
 *  the Broadcasts page, not a structured in-code template. Only reachable
 *  here on a resend of a failed/retried welcome email
 *  (admin_resend_notification, 106); the original send always goes through
 *  lib/email.ts::sendPartnerWelcomeEmail() directly. {{partner_name}} is
 *  replaced the same way that function does it. */
async function buildWelcomeEmail(
  partnerName: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ subject: string; html: string } | null> {
  const { data } = await supabase
    .from("broadcast_campaigns")
    .select("subject, html")
    .eq("is_welcome_template", true)
    .maybeSingle();
  if (!data) return null;

  const fill = (text: string) => text.replace(/\{\{partner_name\}\}/g, partnerName);
  return { subject: fill(data.subject), html: fill(data.html) };
}

type BuiltEmail = {
  subject: string;
  html: string;
  attachment?: { filename: string; content: string };
};

/** Uint8Array -> base64, chunked so a several-KB PDF doesn't blow the call
 *  stack going through String.fromCharCode(...bytes) all at once. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function buildEmail(
  row: NotificationRow,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<BuiltEmail | null> {
  const p = row.payload;
  switch (row.kind) {
    case "booking_new": {
      if (row.recipient_type === "partner") {
        return {
          subject: `New booking — ${p.title}`,
          html: bookingEmailHtml("partner", { title: p.title, when: p.when, party: p.party, ticketCode: p.ticket_code }),
        };
      }

      const html = bookingEmailHtml("customer", { title: p.title, when: p.when, name: p.name, ticketCode: p.ticket_code });
      if (!p.ticket_code) {
        return { subject: `Your booking is confirmed — ${p.title}`, html };
      }
      const pdfBytes = await buildTicketPdf({ title: p.title, when: p.when, ticketCode: p.ticket_code });
      return {
        subject: `Your booking is confirmed — ${p.title}`,
        html,
        attachment: { filename: `${p.ticket_code}.pdf`, content: bytesToBase64(pdfBytes) },
      };
    }
    case "partner_welcome": {
      return buildWelcomeEmail(p.partner_name, supabase);
    }
    case "settlement_ready": {
      const period = `${dateLabel(p.period_start)} – ${dateLabel(p.period_end)}`;
      const heading = `Your settlement for ${period} is ready`;
      return {
        subject: heading,
        html: emailShell(
          heading,
          `<p style="margin:0;">Hi ${p.partner_name},</p><p style="margin:12px 0 0;">This week's settlement has been calculated: <strong>${rupees(p.net_payable_paise)}</strong> across <strong>${p.items_settled}</strong> booking${p.items_settled === 1 ? "" : "s"}, for ${period}.</p>`,
        ),
      };
    }
    case "settlement_paid": {
      const heading = `You've been paid ${rupees(p.net_payable_paise)}`;
      return {
        subject: heading,
        html: emailShell(
          heading,
          `<p style="margin:0;">Hi ${p.partner_name},</p><p style="margin:12px 0 0;"><strong>${rupees(p.net_payable_paise)}</strong> has been sent to the bank/UPI details on file.</p><p style="margin:12px 0 0;">Reference: <strong>${p.payout_reference}</strong></p>`,
        ),
      };
    }
    case "first_listing": {
      // Deliberately not built here. This email carries a large commission
      // table and a static PDF attachment (public/partner-brochure.pdf),
      // already fully implemented once in lib/email.ts::sendPartnerFirstListingEmail
      // — duplicating it here just to cover the rare "resend a failed one"
      // click would mean two copies of a commission table that must never
      // drift apart. A failed first-listing send is re-sent from the admin
      // Broadcasts → first-listing backfill page instead (it calls that same
      // function directly, same as the original send did) — returning null
      // here just makes that limitation explicit rather than silently
      // mis-sending some other kind's content.
      return null;
    }
    case "booking_confirmed": {
      const heading = `${p.title} is confirmed`;
      return {
        subject: heading,
        html: emailShell(
          heading,
          `<p style="margin:0;">Hi ${p.name ?? "there"},</p><p style="margin:12px 0 0;"><strong>${p.title}</strong> · ${p.when} is now confirmed.</p>`,
        ),
      };
    }
    case "booking_disrupted": {
      const heading = `${p.title} was disrupted — weather`;
      return {
        subject: heading,
        html: emailShell(
          heading,
          `<p style="margin:0;">Hi ${p.name ?? "there"},</p><p style="margin:12px 0 0;"><strong>${p.title}</strong> · ${p.when} was disrupted by weather. We'll be in touch about next steps.</p>`,
        ),
      };
    }
    case "booking_refunded": {
      const heading = "You've been refunded";
      return {
        subject: heading,
        html: emailShell(
          heading,
          `<p style="margin:0;">Hi ${p.name ?? "there"},</p><p style="margin:12px 0 0;"><strong>${p.title}</strong> · ${p.when} was refunded${p.note ? ` — ${p.note}` : "."}</p>`,
        ),
      };
    }
  }
}

async function sendResendEmail(
  to: string,
  subject: string,
  html: string,
  attachment?: { filename: string; content: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };

  const body: Record<string, unknown> = { from: FROM, to, subject, html };
  if (attachment) body.attachments = [attachment];

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
  const json = await res.json();
  return { ok: true, id: json.id as string };
}

// Explicit per-kind mapping rather than an if/else-with-fallback — the
// fallback used to silently hand any unrecognised kind (e.g. first_listing,
// which is email-only and has no WhatsApp template at all) the
// settlement_paid template SID instead of failing loudly.
function whatsappTemplateEnvVar(row: NotificationRow): string | null {
  switch (row.kind) {
    case "booking_new":
      return row.recipient_type === "partner" ? "TWILIO_TEMPLATE_BOOKING_PARTNER" : "TWILIO_TEMPLATE_BOOKING_CUSTOMER";
    case "partner_welcome":
      return "TWILIO_TEMPLATE_PARTNER_WELCOME";
    case "settlement_ready":
      return "TWILIO_TEMPLATE_SETTLEMENT_READY";
    case "settlement_paid":
      return "TWILIO_TEMPLATE_SETTLEMENT_PAID";
    case "first_listing":
      return null; // email-only kind — never has a WhatsApp template
    case "booking_confirmed":
      return "TWILIO_TEMPLATE_BOOKING_CONFIRMED";
    case "booking_disrupted":
      return "TWILIO_TEMPLATE_BOOKING_DISRUPTED";
    case "booking_refunded":
      return "TWILIO_TEMPLATE_BOOKING_REFUNDED";
  }
}

function whatsappVariables(row: NotificationRow): Record<string, string> {
  const p = row.payload;
  switch (row.kind) {
    case "booking_new":
      return row.recipient_type === "partner"
        ? { "1": p.title, "2": p.when, "3": String(p.party) }
        : { "1": p.name ?? "there", "2": p.title, "3": p.when };
    case "partner_welcome":
      return { "1": p.partner_name };
    case "settlement_ready":
      return { "1": p.partner_name, "2": rupees(p.net_payable_paise), "3": String(p.items_settled) };
    case "settlement_paid":
      return { "1": p.partner_name, "2": rupees(p.net_payable_paise), "3": p.payout_reference };
    case "first_listing":
      // Unreachable in practice — whatsappTemplateEnvVar() returns null for
      // this kind, and the caller checks that before ever calling here.
      return {};
    case "booking_confirmed":
    case "booking_disrupted":
      return { "1": p.name ?? "there", "2": p.title, "3": p.when };
    case "booking_refunded":
      return { "1": p.name ?? "there", "2": p.title, "3": p.note ?? "" };
  }
}

async function sendTwilioWhatsApp(
  to: string,
  templateSid: string,
  variables: Record<string, string>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM");
  if (!accountSid || !authToken || !from) return { ok: false, error: "Twilio not configured" };

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: `whatsapp:${from}`,
      To: `whatsapp:${to}`,
      ContentSid: templateSid,
      ContentVariables: JSON.stringify(variables),
    }),
  });
  if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${await res.text()}` };
  const json = await res.json();
  return { ok: true, id: json.sid as string };
}

// Title/body for a push row — same three state-change kinds as buildEmail's
// new cases, just the one-line notification-tray version instead of a full
// email. push_title is stamped onto the payload by notify_booking_state_change
// (126) for exactly this; the other two kinds never reach here since nothing
// queues a 'push' row for them (only booking state changes do, today).
function buildPushNotification(row: NotificationRow): { title: string; body: string } | null {
  const p = row.payload;
  switch (row.kind) {
    case "booking_confirmed":
    case "booking_disrupted":
    case "booking_refunded":
      return { title: p.push_title ?? "Booking update", body: `${p.title} · ${p.when}` };
    default:
      return null;
  }
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Same PEM/JWT/OAuth dance as supabase/functions/send-partner-push — see
// that function's comments for why each step is shaped the way it is.
async function pemToCryptoKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function fcmBase64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getFirebaseAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const privateKeyPem = Deno.env.get("FIREBASE_PRIVATE_KEY");
  if (!clientEmail || !privateKeyPem) {
    throw new Error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY not set");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = fcmBase64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = fcmBase64url(
    JSON.stringify({ iss: clientEmail, scope: FCM_SCOPE, aud: FCM_TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const unsigned = `${header}.${claims}`;

  const key = await pemToCryptoKey(privateKeyPem);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${fcmBase64url(signature)}`;

  const res = await fetch(FCM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token as string;
}

// deno-lint-ignore no-explicit-any
async function sendFcmPush(
  supabase: any,
  row: NotificationRow,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const built = buildPushNotification(row);
  if (!built) return { ok: false, error: `${row.kind} has no push content — not a state-change kind` };

  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  if (!projectId) return { ok: false, error: "FIREBASE_PROJECT_ID not set" };

  let accessToken: string;
  try {
    accessToken = await getFirebaseAccessToken();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: row.recipient_address,
        notification: { title: built.title, body: built.body },
        data: { kind: row.kind },
        android: { priority: "high" },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    // UNREGISTERED / NOT_FOUND means the app was uninstalled or the token
    // rotated — that row is dead weight, not a retryable failure. Same
    // cleanup send-partner-push already does for the partner side.
    if (detail.includes("UNREGISTERED") || detail.includes("NOT_FOUND")) {
      await supabase.from("traveller_push_tokens").delete().eq("token", row.recipient_address);
    }
    return { ok: false, error: `FCM ${res.status}: ${detail}` };
  }

  const json = await res.json();
  return { ok: true, id: json.name as string };
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET");
  if (expectedSecret && req.headers.get("x-webhook-secret") !== expectedSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  const payload = (await req.json()) as WebhookPayload;
  if (payload.table !== "notification_log" || payload.type !== "INSERT") {
    return new Response("ignored", { status: 200 });
  }
  const row = payload.record;

  // record_notification() (106) also inserts here, but already 'sent'/
  // 'failed' — a plain log entry for a message lib/email.ts or
  // lib/whatsapp.ts already sent directly. Only a 'pending' row is actually
  // ours to send.
  if (row.status !== "pending") {
    return new Response("not pending, ignored", { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let result: { ok: boolean; id?: string; error?: string };
  if (row.channel === "email") {
    const built = await buildEmail(row, supabase);
    result = built
      ? await sendResendEmail(row.recipient_address, built.subject, built.html, built.attachment)
      : {
          ok: false,
          error:
            row.kind === "first_listing"
              ? "Can't be resent from here — use the first-listing backfill on the admin Broadcasts page instead."
              : "No welcome email set up yet (Admin → Communications → Broadcasts)",
        };
  } else if (row.channel === "whatsapp") {
    const envVar = whatsappTemplateEnvVar(row);
    const templateSid = envVar ? Deno.env.get(envVar) : undefined;
    if (!envVar) {
      result = { ok: false, error: `${row.kind} has no WhatsApp template — this kind is email-only` };
    } else if (!templateSid) {
      result = { ok: false, error: `${envVar} not set` };
    } else {
      result = await sendTwilioWhatsApp(row.recipient_address, templateSid, whatsappVariables(row));
    }
  } else {
    result = await sendFcmPush(supabase, row);
  }

  await supabase
    .from("notification_log")
    .update({
      status: result.ok ? "sent" : "failed",
      provider_message_id: result.id ?? null,
      error: result.ok ? null : (result.error ?? "unknown error"),
      sent_at: result.ok ? new Date().toISOString() : null,
    })
    .eq("id", row.id);

  return new Response(result.ok ? "sent" : `failed: ${result.error}`, { status: result.ok ? 200 : 200 });
});
