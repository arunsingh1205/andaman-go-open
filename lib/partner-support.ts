"use server";

// The partner's side of the conversation with Andaman Go (030). One ongoing
// thread per business; both owner and staff can use it.

import { supabaseServer } from "./supabase-server";
import { istStampLabel } from "./partner-format";

export type SupportMessage = {
  id: string;
  fromPartner: boolean;
  body: string;
  stampLabel: string;
};

export type SupportThread = {
  messages: SupportMessage[];
  status: "open" | "resolved" | null;
};

export type SupportResult = { ok: boolean; message: string };

export async function getSupportThread(partnerId: string): Promise<SupportThread> {
  const supabase = await supabaseServer();

  const [msgs, thread] = await Promise.all([
    supabase
      .from("support_messages")
      .select("id, sender, body, created_at")
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: true }),
    supabase.from("support_threads").select("status").eq("partner_id", partnerId).maybeSingle(),
  ]);

  return {
    messages: (msgs.data ?? []).map((r) => ({
      id: r.id as string,
      fromPartner: r.sender === "partner",
      body: r.body as string,
      stampLabel: istStampLabel(r.created_at as string),
    })),
    status: (thread.data?.status as "open" | "resolved" | undefined) ?? null,
  };
}

export async function sendSupportMessage(body: string): Promise<SupportResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("send_support_message", { p_body: body });
  if (error) return { ok: false, message: "Couldn't send that. Try again." };
  const row = Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't send that." };
}

export async function markSupportRead(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.rpc("mark_support_read");
}
