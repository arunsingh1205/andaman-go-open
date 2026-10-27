import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSettlementReadyEmail } from "@/lib/email";
import { sendSettlementReadyWhatsApp } from "@/lib/whatsapp";

// Vercel Cron's server calling ours, once a week — no browser, no session,
// no cookies, same shape as the Razorpay webhook route. Vercel sends
// `Authorization: Bearer $CRON_SECRET` on every request it triggers when a
// CRON_SECRET env var is set on the project; that's checked here, and the
// very same value is also what run_settlement_cron (105) checks against a
// Supabase Vault secret before it touches anything — two independent gates,
// since this route's secret alone wouldn't stop someone calling the RPC
// directly with the anon key.
//
// This computes and stores what's owed (run_settlement_impl, same math the
// admin's manual "Run settlement" button uses) and emails each affected
// partner that their settlement is ready. It does not move any money — that
// stays a manual bank/UPI transfer an admin confirms via "Mark paid", which
// is what actually sends the "you've been paid" email (lib/admin-settlements.ts).
//
// Configure in vercel.json's `crons`, and set CRON_SECRET in the Vercel
// project's environment variables (and locally in .env.local to test).

function lastFullWeek(): { start: string; end: string } {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const isoDow = istNow.getDay() === 0 ? 7 : istNow.getDay(); // Mon=1..Sun=7
  const thisMonday = new Date(istNow);
  thisMonday.setDate(istNow.getDate() - (isoDow - 1));
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);

  const key = (d: Date) => d.toISOString().slice(0, 10);
  return { start: key(lastMonday), end: key(lastSunday) };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ message: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorised." }, { status: 401 });
  }

  const { start, end } = lastFullWeek();

  const { data, error } = await supabase.rpc("run_settlement_cron", {
    p_period_start: start,
    p_period_end: end,
    p_secret: secret,
  });

  if (error) {
    console.error("run_settlement_cron failed:", error);
    return NextResponse.json({ message: "Settlement run failed." }, { status: 500 });
  }

  const rows = (data ?? []) as {
    partner_id: string;
    partner_name: string | null;
    owner_email: string | null;
    whatsapp_number: string | null;
    items_settled: number;
    net_payable_paise: number;
    period_start: string;
    period_end: string;
  }[];

  const emailed: string[] = [];
  for (const row of rows) {
    if (row.items_settled <= 0 || !row.partner_name) continue;
    const batch = {
      periodStart: row.period_start,
      periodEnd: row.period_end,
      itemsSettled: row.items_settled,
      netPayablePaise: row.net_payable_paise,
    };
    const payload = {
      partner_name: row.partner_name,
      period_start: row.period_start,
      period_end: row.period_end,
      items_settled: row.items_settled,
      net_payable_paise: row.net_payable_paise,
    };

    if (row.owner_email) {
      const sent = await sendSettlementReadyEmail(row.owner_email, row.partner_name, batch).catch((err) => {
        console.error("sendSettlementReadyEmail failed:", err);
        return false;
      });
      if (sent) emailed.push(row.partner_id);
      await supabase.rpc("record_notification", {
        p_channel: "email",
        p_recipient_type: "partner",
        p_recipient_address: row.owner_email,
        p_kind: "settlement_ready",
        p_status: sent ? "sent" : "failed",
        p_payload: payload,
        p_partner_id: row.partner_id,
      });
    }

    if (row.whatsapp_number) {
      const sentWhatsApp = await sendSettlementReadyWhatsApp(row.whatsapp_number, row.partner_name, batch).catch(
        (err) => {
          console.error("sendSettlementReadyWhatsApp failed:", err);
          return false;
        },
      );
      await supabase.rpc("record_notification", {
        p_channel: "whatsapp",
        p_recipient_type: "partner",
        p_recipient_address: row.whatsapp_number,
        p_kind: "settlement_ready",
        p_payload: payload,
        p_status: sentWhatsApp ? "sent" : "failed",
        p_partner_id: row.partner_id,
      });
    }
  }

  return NextResponse.json({ ok: true, period: { start, end }, partnersSettled: rows.length, emailed: emailed.length });
}
