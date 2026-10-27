import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// The one write allowed straight from a public page with no session at all.
// RLS on the waitlist table (057-waitlist.sql) is the real boundary; this
// route just gives the form a friendlier error than a raw Postgres one and
// treats "already signed up" as success rather than a failure.

// In-memory per-IP throttle. Resets on every deploy/restart and won't hold
// across multiple instances — fine for knocking out obvious spam/scripting
// on a low-traffic form; swap for Upstash/Vercel KV if this ever needs to
// survive multi-instance production traffic.
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ message: "Too many requests — try again in a minute." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Bad request." }, { status: 400 });
  }

  const rawEmail = (body as { email?: unknown } | null)?.email;
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";

  if (!email || email.length < 3 || email.length > 254 || !email.includes("@")) {
    return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  }

  const { error } = await supabase.from("waitlist").insert({ email });

  // Postgres 23505 = unique_violation — a repeat signup, not a failure.
  if (error && error.code !== "23505") {
    return NextResponse.json(
      { message: "Something went wrong — try again in a moment." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
