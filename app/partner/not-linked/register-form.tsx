"use client";

// The self-serve entry point Arun asked for: a signed-in Google account that
// isn't linked to a business yet gets this form instead of a wait screen.
// Submitting creates the business (status = "pending") and links this
// account to it as owner in one step — from here the partner lands on
// /partner/welcome and can start adding listings immediately, even before
// Andaman Go has reviewed anything.
//
// Styled as "Step 2 of 2" of the onboarding design — step 1 is
// signup/signup-form.tsx for a brand-new account, or Google sign-in for
// everyone else, so the back arrow here always points at sign-in rather
// than a step that not every partner actually passed through.

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ISLANDS } from "@/lib/islands";
import { registerPartner } from "@/lib/partner-register";
import { PARTNER_KIND_LABEL, type PartnerKind } from "@/lib/partner-kind";
import { BedIcon, CarIcon, DiveIcon, FerryIcon, MusicIcon, PinIcon as CategoryPinIcon, ScooterIcon } from "@/app/icons";
import {
  ArrowRightGlyph,
  BuildingGlyph,
  ChevronLeftGlyph,
  CheckGlyph,
  MailGlyph,
  PinGlyph,
} from "../onboarding-icons";
import NotLinkedSignOut from "./not-linked-sign-out";

const KIND_ICON: Record<PartnerKind, typeof DiveIcon> = {
  dive: DiveIcon,
  ferry: FerryIcon,
  restaurant: BedIcon, // unreachable: 'restaurant' is filtered out of KIND_OPTIONS below
  rental: ScooterIcon,
  venue: MusicIcon,
  cab: CarIcon,
  host: CategoryPinIcon,
  stay: BedIcon,
};
// 'restaurant' is kept in PARTNER_KIND_LABEL only so admin screens can still
// label an existing restaurant partner (095) — it's not offered here, where
// register_partner() would reject it anyway.
const KIND_OPTIONS = (Object.entries(PARTNER_KIND_LABEL) as [PartnerKind, string][]).filter(
  ([k]) => k !== "restaurant",
);

type Field = "name" | "island" | "phone" | "maps" | "email";

const pill = (on: boolean) =>
  `flex h-[58px] items-center gap-3 rounded-[18px] border bg-white px-[18px] transition-colors ${
    on ? "border-[#1F8A80]" : "border-[#E1E9E8]"
  }`;
const fieldInput =
  "min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#0F4C5C] outline-none placeholder:text-[#9DB3B7]";
const hint = "px-1 text-[11.5px] text-[#6B8A90]";

export default function RegisterForm({
  showHero = true,
  askBackupEmail = true,
}: {
  showHero?: boolean;
  /** False after Sign in with Apple: App Review (Guideline 4) rejects any
   *  prompt for a name or email that Apple has already supplied, even an
   *  optional one. */
  askBackupEmail?: boolean;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PartnerKind>("dive");
  const [islandSlug, setIslandSlug] = useState<string>(ISLANDS[0].slug);
  const [contactPhone, setContactPhone] = useState("");
  const [address, setAddress] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [focus, setFocus] = useState<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const canSubmit = name.trim() !== "" && address.trim() !== "" && agreed && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setProblem(null);

    const result = await registerPartner({
      name,
      kind,
      islandSlug,
      contactPhone,
      address,
      mapsUrl,
      ownerEmail,
      termsAccepted: agreed,
    });

    if (!result.ok) {
      setProblem(result.message);
      setBusy(false);
      return;
    }

    window.location.assign("/partner/welcome");
  };

  const fields = (
    <>
      <div className="flex flex-col gap-2">
        <span className="px-1 text-[12px] font-bold tracking-[1.4px] text-[#6B8A90] uppercase">
          Business type
        </span>
        <div className="grid grid-cols-3 gap-2.5">
          {KIND_OPTIONS.map(([value, label]) => {
            const Icon = KIND_ICON[value];
            const on = kind === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center transition-colors ${
                  on ? "border-[#0F4C5C] bg-[#0F4C5C]" : "border-[#E1E9E8] bg-white"
                }`}
              >
                <Icon size={22} className={on ? "text-[#7FD1C5]" : "text-[#6B8A90]"} />
                <span className={`text-[11px] leading-tight font-bold ${on ? "text-white" : "text-[#0F4C5C]"}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <label className={pill(focus === "name")}>
          <BuildingGlyph size={18} className="shrink-0 text-[#6B8A90]" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setFocus("name")}
            onBlur={() => setFocus(null)}
            placeholder="Business name — e.g. Blue Reef Divers"
            aria-label="Business name (the name travellers will see, not your own name)"
            className={fieldInput}
          />
        </label>
        <p className="-mt-1 px-1 text-[12.5px] leading-[1.5] text-[#6B8A90]">
          The name of your shop, boat or homestay as travellers will see it — not your personal name.
        </p>

        <label className={pill(focus === "island")}>
          <PinGlyph size={18} className="shrink-0 text-[#6B8A90]" />
          <select
            value={islandSlug}
            onChange={(e) => setIslandSlug(e.target.value)}
            onFocus={() => setFocus("island")}
            onBlur={() => setFocus(null)}
            className={`${fieldInput} appearance-none`}
          >
            {ISLANDS.map((island) => (
              <option key={island.slug} value={island.slug}>
                {island.full}
              </option>
            ))}
          </select>
        </label>

        <label className={pill(focus === "phone")}>
          <span className="border-r border-[#E1E9E8] pr-3 text-[15px] font-bold text-[#0F4C5C]">+91</span>
          <input
            type="tel"
            inputMode="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            onFocus={() => setFocus("phone")}
            onBlur={() => setFocus(null)}
            placeholder="Contact phone"
            className={fieldInput}
          />
        </label>

        <label className="flex flex-col gap-1.5 rounded-[18px] border border-[#E1E9E8] bg-white p-[18px] focus-within:border-[#1F8A80]">
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Address — Beach No 5, Havelock"
            rows={2}
            className="resize-none bg-transparent text-[15px] font-semibold text-[#0F4C5C] outline-none placeholder:text-[#9DB3B7]"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <label className={pill(focus === "maps")}>
            <PinGlyph size={18} className="shrink-0 text-[#6B8A90]" />
            <input
              value={mapsUrl}
              onChange={(e) => setMapsUrl(e.target.value)}
              onFocus={() => setFocus("maps")}
              onBlur={() => setFocus(null)}
              placeholder="Google Maps link (optional)"
              className={fieldInput}
            />
          </label>
          <p className={hint}>
            Open your shop in Google Maps, tap Share, and paste the link here — this is what
            points a traveller to your door.
          </p>
        </div>

        {askBackupEmail && (
        <div className="flex flex-col gap-1.5">
          <label className={pill(focus === "email")}>
            <MailGlyph size={18} className="shrink-0 text-[#6B8A90]" />
            <input
              type="email"
              inputMode="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              onFocus={() => setFocus("email")}
              onBlur={() => setFocus(null)}
              placeholder="Backup email (optional)"
              className={fieldInput}
            />
          </label>
          <p className={hint}>
            If you ever sign in here with a different Google account, add its email and you can
            reclaim this business from the sign-in screen instead of registering again.
          </p>
        </div>
        )}
      </div>

      <label className="mt-[22px] flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="peer sr-only" />
        <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-[1.5px] border-[#C9D9D7] bg-white transition-colors peer-checked:border-[#1F8A80] peer-checked:bg-[#1F8A80]">
          <CheckGlyph size={12} className="text-white" />
        </span>
        <span className="text-[13px] leading-[1.5] text-[#6B8A90]">
          I have read and agree to the{" "}
          <Link href="/partner-agreement" target="_blank" rel="noopener noreferrer" className="font-bold text-[#0F4C5C]">
            Partner Agreement
          </Link>
          , and I am authorised to accept it for this business.
        </span>
      </label>

      {problem && <p className="mt-3 text-[12.5px] font-medium text-[#C2601F]">{problem}</p>}
    </>
  );

  if (!showHero) {
    return <div className="mt-6 flex flex-col gap-2">{fields}
      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="mt-3 flex h-[58px] w-full items-center justify-center gap-2 rounded-[18px] bg-[#0F4C5C] text-[16px] font-bold text-white shadow-[0_12px_30px_rgba(15,76,92,0.2)] disabled:bg-[#9DB3B7] disabled:shadow-none"
      >
        {busy ? "Registering…" : "Register my business"}
        {!busy && <ArrowRightGlyph size={18} />}
      </button>
    </div>;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F4F8F7]">
      <div className="relative overflow-hidden bg-[#0F4C5C] px-7 tablet:px-[max(1.75rem,calc((100%-560px)/2))] pt-16 pb-[34px] text-white">
        <div className="pointer-events-none absolute -top-[60px] -right-[60px] h-[200px] w-[200px] rounded-full bg-[#1F8A80] opacity-50" />
        <div className="pointer-events-none absolute right-[60px] -bottom-[60px] h-[120px] w-[120px] rounded-full bg-[#7FD1C5] opacity-[0.18]" />

        <div className="relative flex items-center justify-between">
          <Link
            href="/partner/login"
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/12"
          >
            <ChevronLeftGlyph size={18} className="text-white" />
          </Link>
          <Image
            sizes="123px"
            src="/brand/andaman-go-dark-mode.png"
            alt="Andaman Go"
            width={1600}
            height={234}
            className="h-[18px] w-auto"
          />
          <div className="w-10" />
        </div>

        <div className="relative mt-[30px]">
          <p className="text-[12px] font-bold tracking-widest text-[#7FD1C5] uppercase">Step 2 of 2</p>
          <h1 className="mt-2 text-[30px] leading-[1.1] font-extrabold tracking-[-1px]">Register your business</h1>
          <p className="mt-2.5 text-[14px] leading-[1.5] text-[#A9DDD5]">
            Tell us what you offer so travellers can find and book you.
          </p>
        </div>

        <div className="relative mt-4 flex gap-1.5">
          <span className="h-[5px] flex-1 rounded-full bg-[#7FD1C5]" />
          <span className="h-[5px] flex-1 rounded-full bg-[#7FD1C5]" />
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-auto px-7 pt-5 tablet:px-[max(1.75rem,calc((100%-560px)/2))]">
        {fields}

        <div className="mt-auto flex flex-col items-center gap-3 py-3.5">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="flex h-[58px] w-full items-center justify-center gap-2 rounded-[18px] bg-[#0F4C5C] text-[16px] font-bold text-white shadow-[0_12px_30px_rgba(15,76,92,0.2)] disabled:bg-[#9DB3B7] disabled:shadow-none"
          >
            {busy ? "Registering…" : "Finish setup"}
            {!busy && <ArrowRightGlyph size={18} />}
          </button>
          <p className="text-center text-[13px] text-[#9DB3B7]">
            You can edit these details later in Business settings.
          </p>
          <NotLinkedSignOut />
        </div>
      </div>
    </div>
  );
}
