"use server";

// Registers this device's FCM token against the signed-in traveller, so a
// future push (queued into notification_log by notify_booking_state_change,
// 126) knows where to deliver. The RPC resolves the identity from
// auth.uid() directly — never from the client — same discipline as
// lib/partner-push.ts.

import { supabaseServer } from "./supabase-server";

export async function registerTravellerPushToken(
  token: string,
  platform: "android" | "ios",
): Promise<{ ok: boolean }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("register_traveller_push_token", {
    p_token: token,
    p_platform: platform,
  });
  // Failure is silent to the caller (native-bridge.tsx): a device that
  // doesn't get registered this launch tries again next launch.
  return { ok: !error };
}
