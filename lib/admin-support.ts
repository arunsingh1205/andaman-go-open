"use server";

// The admin side of partner support (030). A list of every conversation, and
// the thread + reply for one partner.

import { supabaseServer } from "./supabase-server";
import { istStampLabel } from "./partner-format";

export type SupportThreadRow = {
  partnerId: string;
  partnerName: string;
  status: "open" | "resolved";
  updatedAtLabel: string;
  partnerUnread: number;
  lastBody: string | null;
  lastFromPartner: boolean;
};

export type AdminSupportMessage = {
  id: string;
  fromPartner: boolean;
  body: string;
  stampLabel: string;
};

export type AdminSupportThread = {
  partnerId: string;
  partnerName: string;
  status: "open" | "resolved";
  messages: AdminSupportMessage[];
};

export type SupportActionResult = { ok: boolean; message: string };

function firstRow(data: unknown): { ok: boolean; message: string } | null {
  return Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
}

export async function listSupportThreads(): Promise<SupportThreadRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("admin_support_threads")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error || !data) return [];

  return data.map((r) => ({
    partnerId: r.partner_id as string,
    partnerName: (r.partner_name as string) ?? "A business",
    status: (r.status as "open" | "resolved") ?? "open",
    updatedAtLabel: istStampLabel(r.updated_at as string),
    partnerUnread: (r.partner_unread as number) ?? 0,
    lastBody: (r.last_body as string | null) ?? null,
    lastFromPartner: r.last_sender === "partner",
  }));
}

export async function getAdminSupportThread(
  partnerId: string,
): Promise<AdminSupportThread | null> {
  const supabase = await supabaseServer();

  const [{ data: partner }, { data: threadRow }, { data: msgs }] = await Promise.all([
    supabase.from("partners").select("name").eq("id", partnerId).maybeSingle(),
    supabase.from("support_threads").select("status").eq("partner_id", partnerId).maybeSingle(),
    supabase
      .from("support_messages")
      .select("id, sender, body, created_at")
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: true }),
  ]);

  if (!partner) return null;

  return {
    partnerId,
    partnerName: (partner.name as string) ?? "A business",
    status: (threadRow?.status as "open" | "resolved" | undefined) ?? "open",
    messages: (msgs ?? []).map((m) => ({
      id: m.id as string,
      fromPartner: m.sender === "partner",
      body: m.body as string,
      stampLabel: istStampLabel(m.created_at as string),
    })),
  };
}

export async function adminReplySupport(
  partnerId: string,
  body: string,
): Promise<SupportActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_reply_support", {
    p_partner_id: partnerId,
    p_body: body,
  });
  if (error) return { ok: false, message: "Couldn't send that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't send that." };
}

export async function adminMarkSupportRead(partnerId: string): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.rpc("admin_mark_support_read", { p_partner_id: partnerId });
}

export async function setSupportStatus(
  partnerId: string,
  status: "open" | "resolved",
): Promise<SupportActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_set_support_status", {
    p_partner_id: partnerId,
    p_status: status,
  });
  if (error) return { ok: false, message: "Couldn't update that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't update that." };
}
