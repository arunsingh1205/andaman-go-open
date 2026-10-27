"use client";

// Unlike the welcome campaign's editor (../welcome/welcome-campaign-view.tsx),
// this email's content lives in code (lib/email.ts), so there's nothing to
// edit here — just a test send and the backfill for partners who added a
// listing before 119/120 shipped and so never triggered the automatic send.

import { useState } from "react";
import { sendFirstListingTest, backfillFirstListingEmails } from "@/lib/admin-broadcasts";
import { Panel } from "../../../admin-ui";

export default function FirstListingEmailView() {
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const sendTest = async () => {
    if (!testEmail.trim() || sendingTest) return;
    setSendingTest(true);
    setTestMessage(null);
    const result = await sendFirstListingTest(testEmail.trim());
    setSendingTest(false);
    setTestMessage(result.message);
  };

  const runBackfill = async () => {
    setBackfilling(true);
    setBackfillMessage(null);
    const result = await backfillFirstListingEmails();
    setBackfilling(false);
    setBackfillMessage(result.message);
  };

  return (
    <div className="flex flex-col gap-5 pb-10">
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
          Sent with the partner name filled in as &quot;Test Partner&quot;, brochure PDF attached.
        </p>
      </Panel>

      <Panel title="Send to partners who already have a listing but haven't had this yet">
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
          Safe to click more than once — partners who&apos;ve already received this email, or who have no
          listing yet, are skipped automatically.
        </p>
      </Panel>
    </div>
  );
}
