"use client";

// The welcome email is a standing template, not a one-off broadcast: always
// editable (no "locked after sent" lifecycle), sent automatically on every
// new partner signup, and backfilled to current partners on demand rather
// than blasted to a fixed list once. Same raw-HTML + live-preview editor
// shape as an ordinary broadcast (../[id]/broadcast-editor-view.tsx), minus
// the recipient filter and the destructive one-shot send.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  setUpWelcomeCampaign,
  saveWelcomeCampaign,
  sendBroadcastTest,
  backfillWelcomeCampaign,
  type BroadcastCampaign,
} from "@/lib/admin-broadcasts";
import { Panel } from "../../../admin-ui";

export default function WelcomeCampaignView({ campaign }: { campaign: BroadcastCampaign | null }) {
  if (!campaign) {
    return <SetUpPrompt />;
  }

  return <Editor campaign={campaign} />;
}

function SetUpPrompt() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const setUp = async () => {
    setCreating(true);
    const result = await setUpWelcomeCampaign();
    setCreating(false);
    if (result.ok) router.refresh();
  };

  return (
    <Panel title="Not set up yet">
      <div className="px-5 py-4">
        <p className="text-[13px] font-medium text-muted">
          No welcome email exists yet, so new partner signups currently get nothing. Set one up to start — it comes
          pre-filled with a ready-made design you can edit from there.
        </p>
        <button
          type="button"
          disabled={creating}
          onClick={setUp}
          className="mt-3 h-10 rounded-xl bg-brand px-5 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {creating ? "Setting up…" : "Set up now"}
        </button>
      </div>
    </Panel>
  );
}

function Editor({ campaign }: { campaign: BroadcastCampaign }) {
  const router = useRouter();
  const [subject, setSubject] = useState(campaign.subject);
  const [html, setHtml] = useState(campaign.html);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setSaveMessage(null);
    const result = await saveWelcomeCampaign(campaign.id, { subject, html });
    setSaving(false);
    setSaveMessage(result.message);
    router.refresh();
  };

  const sendTest = async () => {
    if (!testEmail.trim() || sendingTest) return;
    setSendingTest(true);
    setTestMessage(null);
    const fill = (text: string) => text.replace(/\{\{partner_name\}\}/g, "Test Partner");
    const result = await sendBroadcastTest(testEmail.trim(), fill(subject), fill(html));
    setSendingTest(false);
    setTestMessage(result.message);
  };

  const runBackfill = async () => {
    setBackfilling(true);
    setBackfillMessage(null);
    // The real send re-reads the saved row, so save first — same reasoning
    // as the one-off broadcast editor's sendToAll().
    const saved = await saveWelcomeCampaign(campaign.id, { subject, html });
    if (!saved.ok) {
      setBackfilling(false);
      setBackfillMessage(saved.message);
      return;
    }
    const result = await backfillWelcomeCampaign();
    setBackfilling(false);
    setBackfillMessage(result.message);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-5 pb-10">
      <Panel title="Subject">
        <div className="px-5 py-4">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Welcome to Andaman Go, {{partner_name}}"
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] font-medium outline-none focus:border-brand"
          />
          <p className="mt-2 text-[11.5px] font-medium text-muted">
            Use <code className="rounded bg-ground px-1 py-0.5">{"{{partner_name}}"}</code> anywhere in the subject
            or HTML to insert the partner&apos;s business name.
          </p>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="HTML">
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            className="h-[480px] w-full resize-none rounded-b-2xl border-0 bg-surface px-4 py-3 font-mono text-[12px] leading-relaxed outline-none"
          />
        </Panel>
        <Panel title="Preview">
          <iframe
            title="Email preview"
            srcDoc={html.replace(/\{\{partner_name\}\}/g, "Test Partner")}
            className="h-[480px] w-full rounded-b-2xl border-0 bg-white"
          />
        </Panel>
      </div>

      <Panel title="Save">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="h-10 rounded-xl bg-brand px-5 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMessage && <span className="text-[12.5px] font-medium text-muted">{saveMessage}</span>}
        </div>
      </Panel>

      <Panel title="Send a test">
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted uppercase">Send test to</span>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-10 w-64 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium outline-none focus:border-brand"
            />
          </label>
          <button
            type="button"
            disabled={!testEmail.trim() || sendingTest}
            onClick={sendTest}
            className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-brand disabled:text-muted"
          >
            {sendingTest ? "Sending…" : "Send test"}
          </button>
          {testMessage && <span className="text-[12.5px] font-medium text-muted">{testMessage}</span>}
        </div>
        <p className="border-t border-hairline px-5 py-3 text-[11.5px] font-medium text-muted">
          {"{{partner_name}}"} is filled in as &quot;Test Partner&quot; for the test send.
        </p>
      </Panel>

      <Panel title="Send to partners who haven't had this yet">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <button
            type="button"
            disabled={backfilling}
            onClick={runBackfill}
            className="h-10 rounded-xl bg-brand px-5 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {backfilling ? "Sending…" : "Send now"}
          </button>
          {backfillMessage && <span className="text-[12.5px] font-medium text-muted">{backfillMessage}</span>}
        </div>
        <p className="border-t border-hairline px-5 py-3 text-[11.5px] font-medium text-muted">
          Safe to click more than once — partners who&apos;ve already received a welcome email are skipped
          automatically. Saves your edits above first.
        </p>
      </Panel>
    </div>
  );
}
