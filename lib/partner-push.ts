"use server";

// Registers this device's FCM token against the signed-in partner, so a
// future send-side job (Firebase Admin, triggered off partner_notifications)
// knows where to deliver a push. See 094-partner-push-tokens.sql — the RPC
// resolves partner_id from the session the same way markNotificationsRead()
// does, never from the client.

import { supabaseServer } from "./supabase-server";

export async function registerPushToken(
  token: string,
  platform: "android" | "ios",
): Promise<{ ok: boolean }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("register_partner_push_token", {
    p_token: token,
    p_platform: platform,
  });
  // Failure is silent to the caller (native-bridge.tsx): a device that
  // doesn't get registered this launch tries again next launch, same as
  // markNotificationsRead()'s "an unread badge that lingers a bit longer is
  // nobody's emergency."
  return { ok: !error };
}
