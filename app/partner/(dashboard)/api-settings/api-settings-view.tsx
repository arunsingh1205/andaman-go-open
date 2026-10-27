"use client";

// Self-service API keys for a partner running their own booking system
// (099) — create a key (the secret is shown exactly once), set a webhook
// URL for future use, and revoke a key that's no longer needed.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createMyApiKey,
  revokeMyApiKey,
  setMyApiWebhook,
  type ApiKey,
  type CreatedApiKey,
} from "@/lib/partner-api-keys";
import { CheckIcon, CloseIcon, LinkIcon } from "@/app/icons";

export default function ApiSettingsView({ keys }: { keys: ApiKey[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);
  const [webhookDrafts, setWebhookDrafts] = useState<Record<string, string>>({});
  const [webhookBusy, setWebhookBusy] = useState<string | null>(null);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await createMyApiKey(label.trim() || "Default key");
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setJustCreated(result.key);
    setLabel("");
    router.refresh();
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this key? Anything using it will stop working immediately.")) return;
    const result = await revokeMyApiKey(id);
    if (result.ok) router.refresh();
  };

  const saveWebhook = async (id: string) => {
    setWebhookBusy(id);
    const result = await setMyApiWebhook(id, webhookDrafts[id] ?? "");
    setWebhookBusy(null);
    if (result.ok) router.refresh();
  };

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">API access</h2>
      <p className="mt-1 text-[12.5px] font-medium text-muted">
        Run your own booking system? Use these keys to push room-type availability into Andaman Go
        and pull the bookings we&apos;ve taken for you.
      </p>

      {justCreated && (
        <div className="mt-4 rounded-2xl border border-brandsoft bg-brandsoft p-4">
          <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-brand">
            <CheckIcon size={14} />
            Key created — copy it now, it won&apos;t be shown again
          </p>
          <p className="mt-2 break-all rounded-xl bg-white/70 px-3 py-2 font-mono text-[12.5px] font-bold text-ink">
            {justCreated.secret}
          </p>
          <button
            type="button"
            onClick={() => setJustCreated(null)}
            className="mt-2 text-[12px] font-bold text-brand underline"
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <p className="text-[12px] font-bold text-muted uppercase">New key</p>
        <div className="mt-2 flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. My PMS)"
            className="h-11 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[13.5px] font-semibold outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={busy}
            onClick={create}
            className="h-11 shrink-0 rounded-xl bg-brand px-4 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {busy ? "Creating…" : "Create key"}
          </button>
        </div>
        {problem && <p className="mt-2 text-[12px] font-bold text-warn">{problem}</p>}
      </div>

      <ul className="mt-4 flex flex-col gap-2.5">
        {keys.map((k) => (
          <li key={k.id} className="rounded-[16px] border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold">{k.label || "Untitled key"}</p>
                <p className="font-mono text-[11.5px] font-medium text-muted">{k.keyPrefix}…</p>
              </div>
              {k.revokedAt ? (
                <span className="shrink-0 rounded-full bg-sandsoft px-2.5 py-1 text-[10.5px] font-bold text-sandink2">
                  Revoked
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => revoke(k.id)}
                  className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line px-3 text-[11.5px] font-bold text-warn"
                >
                  <CloseIcon size={12} />
                  Revoke
                </button>
              )}
            </div>

            {!k.revokedAt && (
              <div className="mt-2.5 flex items-center gap-2 border-t border-hairline pt-2.5">
                <LinkIcon size={14} className="shrink-0 text-muted" />
                <input
                  value={webhookDrafts[k.id] ?? k.webhookUrl ?? ""}
                  onChange={(e) => setWebhookDrafts((prev) => ({ ...prev, [k.id]: e.target.value }))}
                  placeholder="https://your-system.example.com/webhooks/andaman-go"
                  className="h-9 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-medium outline-none focus:border-brand"
                />
                <button
                  type="button"
                  disabled={webhookBusy === k.id}
                  onClick={() => saveWebhook(k.id)}
                  className="h-9 shrink-0 rounded-lg border border-line px-3 text-[11.5px] font-bold text-ink disabled:opacity-50"
                >
                  {webhookBusy === k.id ? "Saving…" : "Save"}
                </button>
              </div>
            )}

            <p className="mt-1.5 text-[11px] font-medium text-muted">
              {k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleString()}` : "Never used yet"}
            </p>
          </li>
        ))}
        {keys.length === 0 && (
          <p className="mt-4 text-center text-[13px] font-medium text-muted">No keys yet.</p>
        )}
      </ul>
    </>
  );
}
