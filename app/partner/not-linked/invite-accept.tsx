"use client";

// Shown on the not-linked screen when the signed-in email has a pending
// team invite (026). Accepting links this account to that business and drops
// the person straight into the partner app.

import { useState } from "react";
import { acceptPartnerInvite, type MyInvite } from "@/lib/partner-team";

export default function InviteAccept({ invites }: { invites: MyInvite[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const accept = async (invite: MyInvite) => {
    if (busy) return;
    setBusy(invite.inviteId);
    setProblem(null);
    const result = await acceptPartnerInvite(invite.inviteId);
    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }
    window.location.replace("/partner/dashboard");
  };

  return (
    <div className="mt-6 flex flex-col gap-3">
      {invites.map((invite) => (
        <div
          key={invite.inviteId}
          className="rounded-2xl border border-brand bg-brandsoft p-4"
        >
          <p className="text-[13.5px] font-bold text-brand">
            {invite.partnerName} invited you to join their team
          </p>
          <p className="mt-1 text-[12px] font-medium text-brand/80">
            As {invite.role}. You&rsquo;ll be able to work their bookings and check travellers in.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => accept(invite)}
            className="mt-3 h-11 w-full rounded-xl bg-brand text-[13.5px] font-bold text-white disabled:opacity-60"
          >
            {busy === invite.inviteId ? "Joining…" : "Accept invite"}
          </button>
        </div>
      ))}
      {problem && <p className="text-[12px] font-medium text-warn">{problem}</p>}
    </div>
  );
}
