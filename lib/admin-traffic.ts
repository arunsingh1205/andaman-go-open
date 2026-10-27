"use server";

// The Traffic page's numbers — who visited, and from where. One RPC (155),
// admin-only at the database; this just reshapes its json.

import { supabaseServer } from "./supabase-server";

export type Counted = { name: string; visitors: number };

export type Traffic = {
  days: number;
  totals: { visitors: number; sessions: number; pageviews: number; newVisitors: number };
  daily: { day: string; visitors: number; pageviews: number }[];
  sources: (Counted & { sessions: number })[];
  campaigns: (Counted & { source: string; medium: string | null })[];
  referrers: Counted[];
  countries: Counted[];
  regions: (Counted & { country: string | null })[];
  cities: (Counted & { region: string | null })[];
  pages: { name: string; views: number; visitors: number }[];
  devices: Counted[];
};

const EMPTY: Traffic = {
  days: 30,
  totals: { visitors: 0, sessions: 0, pageviews: 0, newVisitors: 0 },
  daily: [],
  sources: [],
  campaigns: [],
  referrers: [],
  countries: [],
  regions: [],
  cities: [],
  pages: [],
  devices: [],
};

export async function getTraffic(days: number): Promise<Traffic & { failed?: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_traffic", { p_days: days });
  if (error || !data) return { ...EMPTY, days, failed: true };
  return { ...EMPTY, ...(data as Partial<Traffic>), days };
}
