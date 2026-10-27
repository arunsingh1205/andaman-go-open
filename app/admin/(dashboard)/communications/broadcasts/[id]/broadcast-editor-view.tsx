"use client";

// Raw-HTML broadcast composer — one-off announcements, the same editor
// shape ../welcome/welcome-campaign-view.tsx uses for the standing welcome
// template. An admin can paste or write whatever HTML they want; the
// tradeoff is real (bad markup here can break across email clients), which
// is why "Send test" exists — check it in an actual inbox before "Send to
// all partners" does.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveBroadcastCampaign,
  deleteBroadcastCampaign,
  sendBroadcastTest,
  sendBroadcastToAllPartners,
  type BroadcastCampaign,
} from "@/lib/admin-broadcasts";
import { PARTNER_KIND_LABEL, recipientKindLabel, type PartnerKind } from "@/lib/partner-kind";
import { Panel } from "../../../admin-ui";

const PARTNER_KINDS = Object.keys(PARTNER_KIND_LABEL) as PartnerKind[];

export default function BroadcastEditorView({ campaign }: { campaign: BroadcastCampaign }) {
  const router = useRouter();
  const readOnly = campaign.status === "sent";

  const [name, setName] = useState(campaign.name);
  const [subject, setSubject] = useState(campaign.subject);
  const [html, setHtml] = useState(campaign.html);
  const [recipientKind, setRecipientKind] = useState<PartnerKind | null>(campaign.recipientKind);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const [confirmingSend, setConfirmingSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setSaveMessage(null);
    const result = await saveBroadcastCampaign(campaign.id, { name, subject, html, recipientKind });
    setSaving(false);
    setSaveMessage(result.message);
    router.refresh();
  };

  const sendTest = async () => {
    if (!testEmail.trim() || sendingTest) return;
    setSendingTest(true);
    setTestMessage(null);
    const result = await sendBroadcastTest(testEmail.trim(), subject, html);
    setSendingTest(false);
    setTestMessage(result.message);
  };

  const sendToAll = async () => {
    setSending(true);
    setSendMessage(null);
    // The real send reads subject/html/recipientKind back off the saved
    // row, not off this form's state — save first so an edit made just
    // before clicking "send" can't be sent as whatever was last saved
    // instead of what's on screen.
    const saved = await saveBroadcastCampaign(campaign.id, { name, subject, html, recipientKind });
    if (!saved.ok) {
      setSending(false);
      setSendMessage(saved.message);
      return;
    }
    const result = await sendBroadcastToAllPartners(campaign.id);
    setSending(false);
    setConfirmingSend(false);
    setSendMessage(result.message);
    router.refresh();
  };

  const remove = async () => {
    await deleteBroadcastCampaign(campaign.id);
    router.push("/admin/communications/broadcasts");
  };

  return (
    <div className="flex flex-col gap-5 pb-10">
      <Panel title="Details">
        <div className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted uppercase">Name (just for you)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium outline-none focus:border-brand disabled:text-muted"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted uppercase">Subject line</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={readOnly}
              placeholder="What partners see in their inbox"
              className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium outline-none focus:border-brand disabled:text-muted"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[11px] font-bold text-muted uppercase">Send to</span>
            <select
              value={recipientKind ?? ""}
              onChange={(e) => setRecipientKind((e.target.value || null) as PartnerKind | null)}
              disabled={readOnly}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] font-medium outline-none focus:border-brand disabled:text-muted md:w-80"
            >
              <option value="">Every partner</option>
              {PARTNER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PARTNER_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="HTML">
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            disabled={readOnly}
            spellCheck={false}
            placeholder="<p>Paste or write your email's HTML here…</p>"
            className="h-[480px] w-full resize-none rounded-b-2xl border-0 bg-surface px-4 py-3 font-mono text-[12px] leading-relaxed outline-none disabled:text-muted"
          />
        </Panel>

        <Panel title="Preview">
          <iframe
            title="Email preview"
            srcDoc={html || "<p style='font-family:sans-serif;color:#999;padding:16px;'>Nothing to preview yet.</p>"}
            className="h-[480px] w-full rounded-b-2xl border-0 bg-white"
          />
        </Panel>
      </div>

      {!readOnly && (
        <Panel title="Save draft">
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="h-10 rounded-xl bg-brand px-5 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            {saveMessage && <span className="text-[12.5px] font-medium text-muted">{saveMessage}</span>}
            <button
              type="button"
              onClick={remove}
              className="ml-auto h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-warn"
            >
              Delete draft
            </button>
          </div>
        </Panel>
      )}

      {!readOnly && (
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
              disabled={!testEmail.trim() || !subject.trim() || !html.trim() || sendingTest}
              onClick={sendTest}
              className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-brand disabled:text-muted"
            >
              {sendingTest ? "Sending…" : "Send test"}
            </button>
            {testMessage && <span className="text-[12.5px] font-medium text-muted">{testMessage}</span>}
          </div>
          <p className="border-t border-hairline px-5 py-3 text-[11.5px] font-medium text-muted">
            Uses whatever&apos;s in the boxes above, saved or not. Always check a test before sending to everyone.
          </p>
        </Panel>
      )}

      {!readOnly && (
        <Panel title={`Send to: ${recipientKindLabel(recipientKind)}`}>
          {!confirmingSend ? (
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <button
                type="button"
                disabled={!subject.trim() || !html.trim()}
                onClick={() => setConfirmingSend(true)}
                className="h-10 rounded-xl bg-warn px-5 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
              >
                Send to {recipientKindLabel(recipientKind).toLowerCase()}
              </button>
              <span className="text-[11.5px] font-medium text-muted">
                One-way — change &quot;Send to&quot; above to target one partner category instead of everyone. Send
                a test first.
              </span>
            </div>
          ) : (
            <div className="px-5 py-4">
              <p className="text-[13px] font-bold text-warn">
                This emails {recipientKindLabel(recipientKind).toLowerCase()} right now and can&apos;t be undone. Are
                you sure?
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={sending}
                  onClick={sendToAll}
                  className="h-10 rounded-xl bg-warn px-5 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
                >
                  {sending ? "Sending…" : "Yes, send to everyone"}
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => setConfirmingSend(false)}
                  className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-ink"
                >
                  Never mind
                </button>
              </div>
            </div>
          )}
          {sendMessage && (
            <p className="border-t border-hairline px-5 py-3 text-[12.5px] font-medium text-muted">{sendMessage}</p>
          )}
        </Panel>
      )}
    </div>
  );
}
