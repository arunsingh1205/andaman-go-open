"use client";

// Same identity-chip + stacked-label grammar Partners uses for a business
// (partners-view.tsx: a 40px rounded-xl box, name/subtitle beside it) —
// carried over here so a person's row reads the same weight as a business's
// row, rather than Staff inventing its own look.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { inviteStaff, removeStaff, type StaffMember } from "@/lib/admin-staff";
import { Panel, EmptyState, RowHead, Row, Cell, Pill } from "../admin-ui";

const COLS = "md:grid-cols-[minmax(0,1.8fr)_110px_130px_minmax(0,auto)]";

export default function StaffView({
  staff,
  currentUserId,
}: {
  staff: StaffMember[];
  currentUserId: string | null;
}) {
  // Owners (the fixed root group) first, oldest first; staff below them,
  // newest invite on top — the one you just sent is the one worth seeing
  // without scrolling.
  const sorted = useMemo(() => {
    return [...staff].sort((a, b) => {
      if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
      const bySeniority = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return a.role === "owner" ? bySeniority : -bySeniority;
    });
  }, [staff]);

  return (
    <>
      <InviteForm />

      <Panel className="mt-5" title={`Access · ${staff.length}`}>
        <RowHead cols={COLS}>
          <span>Person</span>
          <span>Role</span>
          <span>Joined</span>
          <span />
        </RowHead>

        {sorted.length === 0 ? (
          <EmptyState>Nobody has admin access yet.</EmptyState>
        ) : (
          sorted.map((member) => (
            <StaffRow key={member.userId} member={member} isYou={member.userId === currentUserId} />
          ))
        )}
      </Panel>

      <p className="mt-4 text-[12px] font-medium text-muted">
        Staff access covers everything in this console except Revenue, Settlements,
        Communications, and this Staff screen itself — those stay yours only. Inviting someone
        creates their login and emails them a link to set a password; they sign in the same way a
        partner does.
      </p>
    </>
  );
}

function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await inviteStaff(email);
    setBusy(false);
    setMessage({ ok: result.ok, text: result.message });
    if (result.ok) {
      setEmail("");
      router.refresh();
    }
  };

  return (
    <Panel title="Invite staff">
      <div className="px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="name@example.com"
            type="email"
            className="h-10 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[13.5px] font-semibold outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={!email.trim() || busy}
            onClick={submit}
            className="h-10 shrink-0 rounded-button bg-brand px-4 text-[12.5px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {busy ? "Sending…" : "Send invite"}
          </button>
        </div>
        <p className="mt-2.5 text-[12px] font-medium text-muted">
          They&apos;ll get an email with a link to set their own password.
        </p>
        {message && (
          <p className={`mt-2 text-[12px] font-bold ${message.ok ? "text-brand" : "text-warn"}`}>
            {message.text}
          </p>
        )}
      </div>
    </Panel>
  );
}

function StaffRow({ member, isYou }: { member: StaffMember; isYou: boolean }) {
  const isOwner = member.role === "owner";

  return (
    <Row cols={COLS}>
      <Cell>
        <span className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[14px] font-bold ${
              isOwner ? "bg-brandsoft text-brand" : "bg-ground text-muted"
            }`}
          >
            {member.email.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="block truncate text-[13.5px] font-bold">{member.email}</span>
              {isYou && (
                <span className="shrink-0 rounded-full bg-ground px-1.5 py-0.5 text-[10px] font-bold text-muted">
                  You
                </span>
              )}
            </span>
          </span>
        </span>
      </Cell>
      <Cell label="Role">
        <Pill tone={isOwner ? "live" : "muted"}>{member.role}</Pill>
      </Cell>
      <Cell label="Joined">
        <span className="text-[12.5px] font-medium text-muted">
          {new Date(member.createdAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      </Cell>
      <Cell className="flex justify-start md:justify-end">
        {!isOwner && <RemoveStaffButton userId={member.userId} />}
      </Cell>
    </Row>
  );
}

function RemoveStaffButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await removeStaff(userId);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    router.refresh();
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="h-9 shrink-0 rounded-button border border-line bg-surface px-4 text-[12.5px] font-bold text-warn hover:border-warn"
      >
        Remove
      </button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-1.5 md:items-end">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="h-9 shrink-0 rounded-button bg-warn px-4 text-[12.5px] font-bold text-white disabled:opacity-60"
        >
          {busy ? "Removing…" : "Confirm remove"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="h-9 shrink-0 rounded-button border border-line bg-surface px-4 text-[12.5px] font-bold text-ink disabled:opacity-50"
        >
          Never mind
        </button>
      </div>
      {problem && <p className="text-[12px] font-bold text-warn">{problem}</p>}
    </div>
  );
}
