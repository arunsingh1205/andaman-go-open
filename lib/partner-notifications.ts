// The partner's notification feed — new bookings, cancellations, weather
// disruptions, traveller messages, reviews, replies from Andaman Go. Every
// row is written by a trigger (020 and the migrations after it), never by
// the app; this file only reads the feed, counts what's unread, marks it
// seen, and works out where each one links to.

import { supabaseServer } from "./supabase-server";
import type { PartnerNotificationKind } from "./partner-notification-kinds";

export type { PartnerNotificationKind };

export type PartnerNotification = {
  id: string;
  kind: PartnerNotificationKind;
  title: string;
  body: string;
  /** booking_items.id, when the notification is about one — for a deep link. */
  itemId: string | null;
  read: boolean;
  createdAtIso: string;
  /** "just now", "20m ago", "3h ago", "2d ago" — computed at read time. */
  agoLabel: string;
};

type Row = {
  id: string;
  kind: PartnerNotificationKind;
  title: string;
  body: string;
  item_id: string | null;
  read_at: string | null;
  created_at: string;
};

/** "just now" / "20m ago" / "3h ago" / "2d ago" / "12 Feb". */
function agoLabel(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

/** The latest slice of the feed, newest first. */
export async function getPartnerNotifications(): Promise<PartnerNotification[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("partner_notifications")
    .select("id, kind, title, body, item_id, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    throw new Error(`Supabase: could not load notifications — ${error.message}`);
  }

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    itemId: row.item_id,
    read: row.read_at !== null,
    createdAtIso: row.created_at,
    agoLabel: agoLabel(row.created_at),
  }));
}

/** How many are still unread — the number on the bell. */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await supabaseServer();

  const { count, error } = await supabase
    .from("partner_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (error) {
    // A count failing shouldn't take the whole app down — just show no badge.
    return 0;
  }

  return count ?? 0;
}
