"use server";

// The Settings screen's data and writes. Account email comes from the auth
// session; the contact number lives on the partners row; notification
// preferences are their own table (023). Every write is a scoped RPC, same
// discipline as partner-register.ts.

import { supabaseServer } from "./supabase-server";

export type NotificationPrefs = {
  newBooking: boolean;
  cancellation: boolean;
  message: boolean;
};

export type PartnerSettings = {
  email: string | null;
  contactPhone: string | null;
  prefs: NotificationPrefs;
};

export type SettingsResult = { ok: boolean; message: string };

const DEFAULT_PREFS: NotificationPrefs = {
  newBooking: true,
  cancellation: true,
  message: true,
};

function firstRow(data: unknown): { ok: boolean; message: string } | null {
  return Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
}

export async function getPartnerSettings(partnerId: string): Promise<PartnerSettings> {
  const supabase = await supabaseServer();

  const [userResult, bizResult, prefsResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("partners").select("contact_phone").eq("id", partnerId).maybeSingle(),
    supabase
      .from("partner_notification_prefs")
      .select("notify_new_booking, notify_cancellation, notify_message")
      .eq("partner_id", partnerId)
      .maybeSingle(),
  ]);

  const prefsRow = prefsResult.data;

  return {
    email: userResult.data.user?.email ?? null,
    contactPhone: (bizResult.data?.contact_phone as string | null) ?? null,
    prefs: prefsRow
      ? {
          newBooking: prefsRow.notify_new_booking,
          cancellation: prefsRow.notify_cancellation,
          message: prefsRow.notify_message,
        }
      : DEFAULT_PREFS,
  };
}

export async function savePartnerContactPhone(phone: string): Promise<SettingsResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_contact_phone", { p_phone: phone });
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't save that." };
}

export async function savePartnerNotificationPrefs(
  prefs: NotificationPrefs,
): Promise<SettingsResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_notification_prefs", {
    p_new_booking: prefs.newBooking,
    p_cancellation: prefs.cancellation,
    p_message: prefs.message,
  });
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't save that." };
}
