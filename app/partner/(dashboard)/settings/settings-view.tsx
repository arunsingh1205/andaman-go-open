"use client";

// Settings: the account it's signed in as, the number travellers and Andaman
// Go reach the business on, and which events ring the notification bell. The
// preference switches save the moment they're flipped — see
// set_partner_notification_prefs (023); the triggers read that table before
// writing a notification, so a switch off is a real change, not a UI toggle.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOutPartner } from "@/lib/partner-signout";
import {
  savePartnerContactPhone,
  savePartnerNotificationPrefs,
  type NotificationPrefs,
  type PartnerSettings,
} from "@/lib/partner-settings";
import {
  invitePartnerMember,
  removePartnerStaff,
  revokePartnerInvite,
  type PartnerTeam,
} from "@/lib/partner-team";
import { CloseIcon, LogoutIcon } from "@/app/icons";
import DeleteAccountRequest from "@/app/delete-account-request";

export default function SettingsView({
  partnerName,
  settings,
  team,
}: {
  partnerName: string;
  settings: PartnerSettings;
  team: PartnerTeam;
}) {
  const router = useRouter();

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Settings</h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">{partnerName}</p>

      <div className="mt-6 flex flex-col gap-6 desk:max-w-lg">
        <section>
          <SectionTitle>Account</SectionTitle>
          <div className="mt-2 rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl">
            <p className="text-[11px] font-bold tracking-wide text-muted uppercase">Signed in as</p>
            <p className="mt-0.5 text-[13.5px] font-bold break-all">
              {settings.email ?? "—"}
            </p>
          </div>
        </section>

        <BackupOwnerEmail />

        <ContactPhone initial={settings.contactPhone} />

        <TeamSettings team={team} />

        <NotificationSettings initial={settings.prefs} />

        <button
          type="button"
          onClick={async () => {
            await signOutPartner();
            router.replace("/partner/login");
          }}
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[13px] font-bold text-ink"
        >
          <LogoutIcon size={15} className="text-muted" />
          Sign out
        </button>

        {/* App Store Review Guideline 5.1.1(v) — deletion has to start inside
            the app, and the partner app's WebView is scoped to /partner, so
            this renders here rather than linking out to /delete-account. */}
        <section>
          <SectionTitle>Delete this account</SectionTitle>
          <p className="mt-1 text-[12px] font-medium text-muted">
            Removes your business details, listings and payout information. Booking and
            payment records for completed bookings are kept for the period Indian tax law
            requires. Completed within 30 days.
          </p>
          <DeleteAccountRequest account="partner" />
        </section>
      </div>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13.5px] font-bold">{children}</h3>;
}

function TeamSettings({ team }: { team: PartnerTeam }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = async (tag: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    if (busy) return;
    setBusy(tag);
    setProblem(null);
    setNote(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    if (tag === "invite") {
      setNote(result.message);
      setEmail("");
    }
    router.refresh();
  };

  return (
    <section>
      <SectionTitle>Team</SectionTitle>
      <p className="mt-0.5 text-[11.5px] font-medium text-muted">
        Staff can work bookings and check people in. They don&rsquo;t see earnings or listings.
      </p>

      <ul className="mt-2 flex flex-col gap-2">
        {team.members.map((m) => (
          <li
            key={m.memberId}
            className="flex items-center gap-3 rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold">
                {m.email ?? "—"}
                {m.isYou && <span className="font-medium text-muted"> · you</span>}
              </p>
              <p className="text-[10.5px] font-bold tracking-wide text-muted uppercase">{m.role}</p>
            </div>
            {m.role === "staff" && !m.isYou && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run(m.memberId, () => removePartnerStaff(m.memberId))}
                aria-label={`Remove ${m.email}`}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted disabled:opacity-50"
              >
                <CloseIcon size={13} />
              </button>
            )}
          </li>
        ))}

        {team.invites.map((inv) => (
          <li
            key={inv.id}
            className="flex items-center gap-3 rounded-[16px] border border-dashed border-line bg-surface p-3.5 desk:rounded-xl desk:p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-muted">{inv.email}</p>
              <p className="text-[10.5px] font-bold tracking-wide text-muted uppercase">
                {inv.role === "owner" ? "Backup owner · not accepted yet" : "Invited · not accepted yet"}
              </p>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run(inv.id, () => revokePartnerInvite(inv.id))}
              className="h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink disabled:opacity-50"
            >
              Withdraw
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex gap-2">
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="staff@email.com"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[13.5px] font-semibold outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={busy !== null || email.trim() === ""}
          onClick={() => run("invite", () => invitePartnerMember(email.trim(), "staff"))}
          className="h-11 shrink-0 rounded-xl bg-brand px-4 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy === "invite" ? "…" : "Invite"}
        </button>
      </div>
      {note && <p className="mt-2 text-[11.5px] font-medium text-brand">{note}</p>}
      {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
    </section>
  );
}

function BackupOwnerEmail() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async () => {
    if (busy || email.trim() === "") return;
    setBusy(true);
    setNote(null);
    setProblem(null);

    const result = await invitePartnerMember(email.trim(), "owner");

    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setNote(result.message);
    setEmail("");
    router.refresh();
  };

  return (
    <section>
      <SectionTitle>Backup owner email</SectionTitle>
      <p className="mt-0.5 text-[11.5px] font-medium text-muted">
        If you ever sign in here with a different Google account, add its email below now.
        That account will be able to reclaim this business as an owner from the sign-in screen —
        it shows up under Team, further down, once you add it.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="another@email.com"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[13.5px] font-semibold outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={busy || email.trim() === ""}
          onClick={send}
          className="h-11 shrink-0 rounded-xl bg-brand px-4 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "…" : "Add"}
        </button>
      </div>
      {note && <p className="mt-2 text-[11.5px] font-medium text-brand">{note}</p>}
      {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
    </section>
  );
}

function ContactPhone({ initial }: { initial: string | null }) {
  const [phone, setPhone] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const dirty = phone.trim() !== (initial ?? "");

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    setProblem(null);
    const result = await savePartnerContactPhone(phone.trim());
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section>
      <SectionTitle>Business contact number</SectionTitle>
      <p className="mt-0.5 text-[11.5px] font-medium text-muted">
        Where Andaman Go reaches you about a booking.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="9876543210"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={save}
          className="h-11 shrink-0 rounded-xl bg-brand px-4 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
    </section>
  );
}

const PREF_ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: "newBooking", label: "New bookings", hint: "Someone books, or a booking needs confirmation" },
  { key: "cancellation", label: "Cancellations", hint: "Andaman Go cancels a booking, or weather disrupts one" },
  { key: "message", label: "Messages", hint: "A traveller messages you about a booking" },
];

function NotificationSettings({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = async (key: keyof NotificationPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setProblem(null);
    const result = await savePartnerNotificationPrefs(next);
    if (!result.ok) {
      setPrefs(prefs); // revert
      setProblem(result.message);
    }
  };

  return (
    <section>
      <SectionTitle>Notifications</SectionTitle>
      <p className="mt-0.5 text-[11.5px] font-medium text-muted">
        What rings the bell in the app.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {PREF_ROWS.map((row) => (
          <li
            key={row.key}
            className="flex items-center gap-3 rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold">{row.label}</p>
              <p className="mt-0.5 text-[11px] font-medium text-muted">{row.hint}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[row.key]}
              aria-label={row.label}
              onClick={() => toggle(row.key)}
              className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                prefs[row.key] ? "bg-brand" : "bg-line"
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  prefs[row.key] ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </li>
        ))}
      </ul>
      {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
    </section>
  );
}
