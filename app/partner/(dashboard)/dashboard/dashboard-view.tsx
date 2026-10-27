"use client";

// The new front door for the partner app. Every number on it is read, not
// invented — see lib/partner-dashboard.ts. Bookings arrive already paid and
// confirmed (034), so the dashboard's job is to surface what's due and who
// still needs checking in, not to chase yes/no answers.
//
// Mobile layout matches the onboarding mockup's Dashboard screen pixel-for-
// pixel (teal setup hero, segmented progress, icon-chip stat tiles); desktop
// keeps its original card-based layout untouched — see the desk:hidden /
// hidden desk:block split in OnboardingCard.

import Link from "next/link";
import { rupees } from "@/lib/activities";
import type { BookingKind } from "@/lib/bookings";
import type { PartnerBooking } from "@/lib/partner-bookings";
import type { DeliveredBooking } from "@/lib/partner-delivered";
import type { PartnerDashboard } from "@/lib/partner-dashboard";
import type { ChecklistStep, PartnerOnboarding } from "@/lib/partner-onboarding";
import { StatTile } from "../stat-tile";
import {
  CarIcon,
  CheckIcon,
  ChevronIcon,
  DiveIcon,
  EarningsIcon,
  FerryIcon,
  MusicIcon,
  PinIcon,
  PlusIcon,
  BedIcon,
  QrIcon,
  ScooterIcon,
  TicketIcon,
} from "@/app/icons";

const KIND_ICON: Record<BookingKind, typeof DiveIcon> = {
  activity: DiveIcon,
  ferry: FerryIcon,
  stay: BedIcon,
  event: MusicIcon,
  cab: CarIcon,
  trip: PinIcon,
  rental: ScooterIcon,
};

export default function DashboardView({
  partnerName,
  greeting,
  dashboard,
  onboarding,
  canAddListing,
}: {
  partnerName: string;
  greeting: string;
  dashboard: PartnerDashboard;
  onboarding: PartnerOnboarding | null;
  canAddListing: boolean;
}) {
  const { stats } = dashboard;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-bold tracking-wide text-muted uppercase">{greeting}</p>
          <h2 className="font-display mt-0.5 truncate text-[22px] font-bold tracking-tight desk:text-[26px]">
            {partnerName}
          </h2>
        </div>
        {canAddListing && (
          <Link
            href="/partner/business/new"
            aria-label="Add a listing"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm desk:h-auto desk:w-auto desk:gap-1.5 desk:rounded-xl desk:px-4 desk:py-2.5"
          >
            <PlusIcon size={18} />
            <span className="hidden text-[13px] font-bold desk:inline">Add listing</span>
          </Link>
        )}
      </div>

      {onboarding && <OnboardingCard onboarding={onboarding} />}

      <div className="mt-5 grid grid-cols-2 gap-2.5 tablet:grid-cols-4 desk:grid-cols-4 desk:gap-4">
        <StatTile
          label="To check in today"
          value={String(stats.arrivalsToCheckIn)}
          tone={stats.arrivalsToCheckIn > 0 ? "warn" : "brand"}
          accent="teal"
          Icon={CheckIcon}
        />
        <StatTile
          label="Due today"
          value={String(stats.todayCount)}
          tone="brand"
          accent="orange"
          Icon={TicketIcon}
        />
        <StatTile
          label="Checked in today"
          value={String(stats.checkedInToday)}
          tone="sand"
          accent="purple"
          Icon={QrIcon}
        />
        <StatTile
          label="Completed this month"
          value={String(stats.completedThisMonth)}
          sub={stats.completedThisMonthPaise > 0 ? rupees(stats.completedThisMonthPaise) : undefined}
          tone="brand"
          accent="coral"
          Icon={EarningsIcon}
        />
      </div>

      <div className="mt-7 grid gap-6 tablet:grid-cols-2 desk:grid-cols-2 desk:gap-8">
        <section>
          <SectionHeading title="To check in today" href="/partner/check-in" />
          {dashboard.toCheckIn.length === 0 ? (
            <EmptyNote>No one left to check in today.</EmptyNote>
          ) : (
            <ul className="mt-3 flex flex-col gap-2.5">
              {dashboard.toCheckIn.map((b) => (
                <MiniRow key={b.itemId} booking={b} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHeading title="Today" href="/partner/bookings" />
          {dashboard.today.length === 0 ? (
            <EmptyNote>Nothing on the books for today.</EmptyNote>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {dashboard.today.map((b) => (
                <MiniRow key={b.itemId} booking={b} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-7">
        <SectionHeading title="Recently checked in" href="/partner/earnings" />
        {dashboard.recentlyDelivered.length === 0 ? (
          <EmptyNote>Nothing checked in yet.</EmptyNote>
        ) : (
          <ul className="mt-3 grid gap-2 desk:grid-cols-2">
            {dashboard.recentlyDelivered.map((d) => (
              <DeliveredRow key={d.key} item={d} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function OnboardingCard({ onboarding }: { onboarding: PartnerOnboarding }) {
  const { steps, doneCount, total } = onboarding;
  const pct = Math.round((doneCount / total) * 100);
  const hint =
    doneCount === total
      ? "All set. You are ready to go live."
      : `${total - doneCount} step${total - doneCount === 1 ? "" : "s"} left to go live`;

  return (
    <>
      {/* Mobile: teal setup hero + separate white steps card, matching the
          onboarding mockup's Dashboard screen exactly. */}
      <div className="desk:hidden">
        <div className="relative mt-5 overflow-hidden rounded-[30px] bg-brand p-6 text-white">
          <div className="pointer-events-none absolute -top-[50px] -right-[50px] h-[190px] w-[190px] rounded-full bg-[#1F8A80] opacity-50" />
          <div className="pointer-events-none absolute -bottom-[70px] right-[30px] h-[150px] w-[150px] rounded-full bg-[#7FD1C5] opacity-[0.18]" />

          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-[12px] font-bold tracking-widest text-brandmint uppercase">Setup</p>
              <p className="mt-1.5 text-[19px] leading-[1.2] font-bold">
                Finish setting up
                <br />
                your business
              </p>
            </div>
            <p className="text-[38px] leading-none font-extrabold tracking-[-2px]">
              {doneCount}
              <span className="text-[16px] font-semibold tracking-normal text-brandmint">/{total}</span>
            </p>
          </div>

          <div className="relative mt-[22px] flex gap-1.5">
            {steps.map((step) => (
              <span
                key={step.id}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  step.done ? "bg-brandmint" : "bg-white/[0.18]"
                }`}
              />
            ))}
          </div>
          <p className="relative mt-2.5 text-[13px] text-brandmint/90">{hint}</p>
        </div>

        <div className="mt-3.5 rounded-[26px] border border-line bg-surface p-2">
          {steps.map((step) => (
            <MobileStepRow key={step.id} step={step} />
          ))}
        </div>
      </div>

      {/* Desktop: original combined card, unchanged. */}
      <div className="hidden desk:block">
        <div className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-sm desk:p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[14.5px] font-bold">Finish setting up</h3>
            <span className="text-[12px] font-bold text-muted">
              {doneCount} of {total}
            </span>
          </div>

          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ground">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>

          <ul className="mt-3.5 flex flex-col gap-1.5">
            {steps.map((step) => (
              <DesktopStepRow key={step.id} step={step} />
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function MobileStepRow({ step }: { step: ChecklistStep }) {
  if (step.done) {
    return (
      <span className="flex items-center gap-3.5 rounded-[18px] px-3.5 py-3">
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand text-white">
          <CheckIcon size={13} />
        </span>
        <span className="flex-1 text-[15px] font-semibold text-muted line-through">{step.label}</span>
      </span>
    );
  }
  return (
    <Link
      href={step.href}
      className="flex items-center gap-3.5 rounded-[18px] px-3.5 py-3 active:bg-ground"
    >
      <span className="h-[26px] w-[26px] shrink-0 rounded-full border-[1.5px] border-line" />
      <span className="flex-1 text-[15px] font-semibold text-ink">{step.label}</span>
      <ChevronIcon size={16} className="text-muted" />
    </Link>
  );
}

function DesktopStepRow({ step }: { step: ChecklistStep }) {
  return (
    <li>
      {step.done ? (
        <span className="flex items-center gap-2.5 py-1 text-[13px] font-medium text-muted">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-white">
            <CheckIcon size={11} />
          </span>
          <span className="line-through">{step.label}</span>
        </span>
      ) : (
        <Link href={step.href} className="flex items-center gap-2.5 py-1 text-[13px] font-bold text-ink">
          <span className="h-5 w-5 shrink-0 rounded-full border border-line" />
          {step.label}
          <ChevronIcon size={13} className="ml-auto text-muted" />
        </Link>
      )}
    </li>
  );
}

function SectionHeading({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[14.5px] font-bold">{title}</h3>
      <Link href={href} className="flex items-center gap-0.5 text-[12px] font-bold text-brand">
        See all
        <ChevronIcon size={13} />
      </Link>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[12.5px] font-medium text-muted">{children}</p>;
}

function MiniRow({ booking }: { booking: PartnerBooking }) {
  const Icon = KIND_ICON[booking.kind];
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brandsoft text-brand">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold">{booking.title}</p>
        <p className="text-[11px] font-medium text-muted">{booking.timeLabel}</p>
      </div>
      <span className="shrink-0 rounded-full bg-line px-2 py-1 text-[10px] font-bold text-muted">
        {booking.state === "confirmed" ? "Confirmed" : booking.state}
      </span>
    </li>
  );
}

function DeliveredRow({ item }: { item: DeliveredBooking }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-line text-muted">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold">{item.title}</p>
        <p className="text-[11px] font-medium text-muted">
          {item.redeemedDateLabel} · {item.redeemedTimeLabel}
        </p>
      </div>
      <span className="shrink-0 text-[12.5px] font-bold text-ink">
        {item.pricePaise === 0 ? "Free" : rupees(item.pricePaise)}
      </span>
    </li>
  );
}
