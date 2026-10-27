import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseApiKey } from "@/lib/partner-api-auth";

// GET /api/partner/v1/bookings?since=<ISO timestamp>&limit=<n> — a partner's
// own booking system pulls what Andaman Go has booked for them since a given
// moment. Reliable fallback to the best-effort outbound webhook
// (lib/stay-webhook.ts) fired right after a booking succeeds. Authenticated
// the same way as PUT /availability — see api_list_partner_bookings (099).

export async function GET(request: Request) {
  const key = parseApiKey(request.headers.get("authorization"));
  if (!key) {
    return NextResponse.json(
      { ok: false, message: "Missing or malformed Authorization header — expected 'Bearer <api key>'." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 50;

  const { data, error } = await supabase.rpc("api_list_partner_bookings", {
    p_key_prefix: key.prefix,
    p_key_hash: key.hash,
    p_since: since && !Number.isNaN(Date.parse(since)) ? since : null,
    p_limit: Number.isFinite(limit) ? limit : 50,
  });

  if (error) {
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }

  const rows = (data ?? []) as {
    item_id: string;
    kind: string;
    ref_code: string;
    ticket_code: string | null;
    title: string | null;
    room_type_code: string | null;
    starts_at: string;
    party: number;
    units: number;
    price_paise: number;
    pay_mode: string;
    paid_online_paise: number;
    balance_paise: number;
    state: string;
    contact_phone: string | null;
    contact_email: string | null;
    booked_at: string;
  }[];

  return NextResponse.json({
    ok: true,
    bookings: rows.map((r) => ({
      id: r.item_id,
      kind: r.kind,
      refCode: r.ref_code,
      ticketCode: r.ticket_code,
      title: r.title,
      roomTypeCode: r.room_type_code,
      startsAt: r.starts_at,
      guests: r.party,
      nights: r.units,
      pricePaise: r.price_paise,
      payMode: r.pay_mode,
      paidOnlinePaise: r.paid_online_paise,
      balancePaise: r.balance_paise,
      state: r.state,
      contactPhone: r.contact_phone,
      contactEmail: r.contact_email,
      bookedAt: r.booked_at,
    })),
  });
}
