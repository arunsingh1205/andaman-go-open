import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseApiKey } from "@/lib/partner-api-auth";

// PUT /api/partner/v1/availability — a partner's own booking system pushes
// open/closed nights for one of their room types. Body:
//   { roomTypeCode: string, dates: { date: string, available: boolean, reason?: string }[] }
// Authenticated by the "Authorization: Bearer <api key>" header — see
// lib/partner-api-auth.ts and api_push_stay_availability (099), which does
// the actual key check and the write in one database call.

export async function PUT(request: Request) {
  const key = parseApiKey(request.headers.get("authorization"));
  if (!key) {
    return NextResponse.json(
      { ok: false, message: "Missing or malformed Authorization header — expected 'Bearer <api key>'." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Bad request body." }, { status: 400 });
  }

  const { roomTypeCode, dates } = (body ?? {}) as { roomTypeCode?: unknown; dates?: unknown };
  if (typeof roomTypeCode !== "string" || !roomTypeCode) {
    return NextResponse.json({ ok: false, message: "roomTypeCode is required." }, { status: 400 });
  }
  if (!Array.isArray(dates) || dates.length === 0) {
    return NextResponse.json({ ok: false, message: "dates must be a non-empty array." }, { status: 400 });
  }
  if (dates.length > 366) {
    return NextResponse.json({ ok: false, message: "Send at most 366 dates per call." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("api_push_stay_availability", {
    p_key_prefix: key.prefix,
    p_key_hash: key.hash,
    p_room_type_code: roomTypeCode,
    p_dates: dates.map((d) => {
      const row = (d ?? {}) as { date?: unknown; available?: unknown; reason?: unknown };
      return {
        date: typeof row.date === "string" ? row.date : null,
        available: row.available !== false,
        reason: typeof row.reason === "string" ? row.reason : null,
      };
    }),
  });

  if (error) {
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }

  const row = Array.isArray(data)
    ? (data[0] as { ok: boolean; message: string; nights_updated: number })
    : null;

  if (!row?.ok) {
    const status = row?.message === "Invalid or revoked API key." ? 401 : 400;
    return NextResponse.json({ ok: false, message: row?.message ?? "Request failed." }, { status });
  }

  return NextResponse.json({ ok: true, message: row.message, nightsUpdated: row.nights_updated });
}
