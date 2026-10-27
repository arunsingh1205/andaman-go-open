"use server";

// A partner's own API keys (099) — for a partner running their own booking
// system/PMS who wants to push availability and pull bookings from Andaman
// Go directly, without going through the app. Same crypto discipline as
// lib/razorpay.ts's HMAC verification: the secret is generated and hashed
// here in Node, and only the prefix + hash ever reach Postgres — the RPC
// never sees, and can never leak, the raw secret.

import crypto from "crypto";
import { supabaseServer } from "./supabase-server";

export type ApiKey = {
  id: string;
  label: string;
  keyPrefix: string;
  webhookUrl: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreatedApiKey = ApiKey & {
  /** Shown exactly once, in the response to creating a key — never stored,
   *  never retrievable again. */
  secret: string;
};

const PREFIX = "agk";

function hash(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export async function listMyApiKeys(): Promise<ApiKey[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("list_partner_api_keys");
  if (error || !data) return [];

  return (
    data as {
      id: string;
      label: string;
      key_prefix: string;
      webhook_url: string | null;
      last_used_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    label: row.label,
    keyPrefix: row.key_prefix,
    webhookUrl: row.webhook_url,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));
}

export async function createMyApiKey(
  label: string,
): Promise<{ ok: true; key: CreatedApiKey } | { ok: false; message: string }> {
  const raw = crypto.randomBytes(24).toString("hex"); // 48 hex chars
  const secret = `${PREFIX}_${raw}`;
  const keyPrefix = secret.slice(0, 16);
  const keyHash = hash(secret);
  const webhookSecret = crypto.randomBytes(24).toString("hex");

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("create_partner_api_key", {
    p_label: label,
    p_key_prefix: keyPrefix,
    p_key_hash: keyHash,
    p_webhook_secret: webhookSecret,
  });
  if (error) return { ok: false, message: error.message || "Couldn't create a key. Try again." };

  const row = Array.isArray(data)
    ? (data[0] as { ok: boolean; message: string; id: string })
    : null;
  if (!row?.ok || !row.id) return { ok: false, message: row?.message ?? "Couldn't create a key." };

  return {
    ok: true,
    key: {
      id: row.id,
      label,
      keyPrefix,
      webhookUrl: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      secret,
    },
  };
}

export async function revokeMyApiKey(id: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("revoke_partner_api_key", { p_id: id });
  if (error) return { ok: false, message: error.message || "Couldn't revoke that key. Try again." };
  const row = Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't revoke that key." };
}

export async function setMyApiWebhook(
  id: string,
  webhookUrl: string,
): Promise<{ ok: boolean; message: string }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_api_webhook", {
    p_id: id,
    p_webhook_url: webhookUrl,
  });
  if (error) return { ok: false, message: error.message || "Couldn't save that. Try again." };
  const row = Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't save that." };
}
