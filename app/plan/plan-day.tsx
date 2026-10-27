"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { rupees } from "@/lib/activities";
import { ensureSession } from "@/lib/supabase-browser";
import { chargeViaRazorpay, makeReceipt, MIN_CHARGE_PAISE } from "@/lib/razorpay-client";
import type { PlanInventory, PlanKind, PlanOption } from "@/lib/day-plan";
import type { PlanIssue } from "@/lib/day-plan-conflicts";
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  CloseIcon,
  DiveIcon,
  MusicIcon,
  PlusIcon,
  ScooterIcon,
  StarIcon,
} from "@/app/icons";
import { preparePlanBooking, bookPlanItem, validatePlan, type PlanBookResult } from "./actions";

type BasketLine = { key: string; startsAt: string | null; note?: string };

// Experiences first, logistics last — the order is deliberate. Nobody plans a
// day starting from "which scooter", and leading with rides was quietly telling
// them they had to.
const SERVICES: {
  id: PlanKind;
  label: string;
  blurb: string;
  Icon: typeof DiveIcon;
}[] = [
  { id: "activity", label: "Activities", blurb: "Scuba, sea walk, snorkel, water sports, stargazing", Icon: DiveIcon },
  { id: "event", label: "Events", blurb: "DJ sets, live music, comedy, theatre, festivals", Icon: MusicIcon },
  { id: "ride", label: "Rides", blurb: "A scooter or cycle for the whole day", Icon: ScooterIcon },
];

const MIN_GUESTS = 1;
const MAX_GUESTS = 8;

export default function PlanDay({
  inventory,
  islandSlug,
  islandName,
  guests: initialGuests,
  dayKey,
  dayLabel,
}: {
  inventory: PlanInventory;
  islandSlug: string;
  islandName: string;
  guests: number;
  dayKey: string;
  dayLabel: string;
}) {
  const [guests, setGuests] = useState(initialGuests);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [issues, setIssues] = useState<PlanIssue[]>([]);
  const [browsing, setBrowsing] = useState(false);
  // null = show the service chooser; a kind = show that service's listings.
  const [service, setService] = useState<PlanKind | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [booking, setBooking] = useState(false);
  const [results, setResults] = useState<PlanBookResult[] | null>(null);
  // How many stops the current run is charging/booking — lets the results
  // screen tell "done" apart from "still working through the rest of the
  // day," since results now fill in one stop at a time rather than all at
  // once.
  const [totalStops, setTotalStops] = useState(0);
  const [bookError, setBookError] = useState<string | null>(null);

  const byKey = useMemo(() => {
    const all = [...inventory.rides, ...inventory.activities, ...inventory.events];
    return new Map(all.map((o) => [o.key, o]));
  }, [inventory]);

  const listFor = (k: PlanKind) =>
    k === "ride" ? inventory.rides : k === "activity" ? inventory.activities : inventory.events;

  // Basket lines resolved to their option + sorted: all-day rides first, then
  // timed stops in the order the day runs.
  const lines = useMemo(() => {
    return basket
      .map((b) => ({ b, o: byKey.get(b.key) }))
      .filter((x): x is { b: BasketLine; o: PlanOption } => Boolean(x.o))
      .sort((x, y) => {
        const xt = x.b.startsAt ? Date.parse(x.b.startsAt) : -1;
        const yt = y.b.startsAt ? Date.parse(y.b.startsAt) : -1;
        return xt - yt;
      });
  }, [basket, byKey]);

  // --- validation (server is the authority; this is the fast echo) ---------
  const runId = useRef(0);
  useEffect(() => {
    const id = ++runId.current;
    if (basket.length === 0) {
      // Clear asynchronously — never setState in an effect body.
      Promise.resolve().then(() => {
        if (id === runId.current) setIssues([]);
      });
      return;
    }
    const t = setTimeout(async () => {
      const next = await validatePlan({
        islandSlug,
        dayKey,
        guests,
        lines: basket.map((b) => ({ key: b.key, startsAt: b.startsAt })),
      });
      if (id === runId.current) setIssues(next);
    }, 250);
    return () => clearTimeout(t);
  }, [basket, guests, islandSlug, dayKey]);

  const activeIssues = basket.length > 0 ? issues : [];
  const blocks = activeIssues.filter((i) => i.level === "block");
  const warns = activeIssues.filter((i) => i.level === "warn");
  const flagged = (key: string, level: "block" | "warn") =>
    activeIssues.some((i) => i.level === level && i.keys.includes(key));

  // --- pricing ---------------------------------------------------------
  // A day plan is paid in full, upfront — no deposits, nothing owed later.
  const linePrice = (o: PlanOption) =>
    o.priceUnit === "day" ? o.pricePaise : o.pricePaise * guests;

  const dayTotal = lines.reduce((s, { o }) => s + linePrice(o), 0);

  // --- basket ops -------------------------------------------------------
  const openBrowse = () => {
    setBrowsing(true);
    setService(null);
    setDetailKey(null);
  };

  const inBasket = (key: string) => basket.some((b) => b.key === key);
  const addOrUpdate = (key: string, startsAt: string | null) => {
    setBasket((prev) => {
      const rest = prev.filter((b) => b.key !== key);
      return [...rest, { key, startsAt }];
    });
    setResults(null);
    setBookError(null);
  };
  const remove = (key: string) => {
    setBasket((prev) => prev.filter((b) => b.key !== key));
    setResults(null);
    setBookError(null);
  };

  // --- booking ---------------------------------------------------------
  // One stop at a time: charge it via Razorpay, then book it, then move to
  // the next — booking_items only ever accepts one payment per booking, so
  // there's no single combined charge for the whole day (see actions.ts).
  // Results fill in as each stop clears, since a multi-stop day now means a
  // Razorpay confirmation per stop rather than one instant screen.
  const runBook = async (consented: boolean) => {
    setBooking(true);
    setBookError(null);
    setConsentOpen(false);
    try {
      await ensureSession();
      const prepared = await preparePlanBooking(
        {
          islandSlug,
          dayKey,
          guests,
          lines: basket.map((b) => ({ key: b.key, startsAt: b.startsAt })),
        },
        { consented },
      );
      if (!prepared.ok) {
        setIssues(prepared.issues);
        if (prepared.needsConsent) {
          setConsentOpen(true);
        } else {
          setBookError("Something in the day clashes — check the flags below.");
        }
        return;
      }
      setIssues(prepared.issues);
      setTotalStops(prepared.items.length);

      const results: PlanBookResult[] = [];

      for (const item of prepared.items) {
        try {
          const razorpay =
            item.chargePaise < MIN_CHARGE_PAISE
              ? undefined
              : await chargeViaRazorpay({
                  amountPaise: item.chargePaise,
                  receipt: makeReceipt(`plan-${item.key}`),
                  description: item.title,
                });

          const res = await bookPlanItem({
            bookKind: item.bookKind,
            bookSubject: item.bookSubject,
            bookVariant: item.bookVariant,
            startsAt: item.startsAt,
            guests: item.guests,
            razorpay,
          });

          results.push(
            res.ok
              ? {
                  key: item.key,
                  title: item.title,
                  ok: true,
                  ref: res.ref,
                  ticket: res.ticket,
                  pricePaise: res.pricePaise,
                }
              : { key: item.key, title: item.title, ok: false, message: res.message },
          );
        } catch (error) {
          // The Razorpay charge itself failed or was cancelled — nothing was
          // booked or charged for this stop.
          results.push({
            key: item.key,
            title: item.title,
            ok: false,
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
        setResults([...results]);
      }
    } catch (error) {
      setBookError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBooking(false);
    }
  };

  const onBook = () => {
    if (basket.length === 0 || blocks.length > 0) return;
    if (warns.length > 0) setConsentOpen(true);
    else runBook(false);
  };

  // --- results screen -------------------------------------------------
  if (results) {
    const done = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const ref = done.find((r) => r.ref)?.ref ?? null;
    // Results fill in one stop at a time now (one Razorpay charge each), so
    // this screen can be showing partial progress, not a final outcome yet.
    const pending = results.length < totalStops;
    return (
      <main className="page-flow pt-6 pb-24">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
            pending ? "bg-ground text-muted" : failed.length === 0 ? "bg-brand text-white" : "bg-sandsoft text-sandicon"
          }`}
        >
          {pending ? (
            <ClockIcon size={20} />
          ) : failed.length === 0 ? (
            <CheckIcon size={22} />
          ) : (
            <AlertIcon size={20} />
          )}
        </div>
        <h2 className="mt-3 font-display text-[21px] font-bold tracking-tight">
          {pending
            ? `Booking stop ${results.length + 1} of ${totalStops}…`
            : failed.length === 0
              ? "Your day is booked"
              : done.length === 0
                ? "Nothing went through"
                : "Part of your day is booked"}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed font-medium text-muted">
          {pending
            ? "Each stop is charged on its own — don't close this while the rest of the day finishes booking."
            : failed.length === 0
              ? "Paid in full. Every stop has its own ticket and QR in your bookings — cancel or change any one without touching the rest."
              : "The stops below that didn't book weren't charged. Try them again from their own screen."}
        </p>

        {ref && (
          <p className="mt-4 text-[12px] font-semibold text-muted">
            Day reference{" "}
            <span className="font-display text-[14px] font-bold tracking-wide text-ink">
              {ref}
            </span>
          </p>
        )}

        <ul className="mt-3 flex flex-col gap-2.5">
          {results.map((r) => (
            <li
              key={r.key}
              className="flex items-start gap-3 rounded-[16px] border border-line bg-surface p-3.5"
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  r.ok ? "bg-brandsoft text-brand" : "bg-sandsoft text-sandicon"
                }`}
              >
                {r.ok ? <CheckIcon size={13} /> : <CloseIcon size={13} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold">{r.title}</p>
                {r.ok ? (
                  <p className="mt-0.5 text-[12px] font-medium text-muted">
                    <span className="font-bold text-ink">{r.ticket}</span>
                    {r.pricePaise ? ` · ${rupees(r.pricePaise)} paid` : " · free"}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[12px] font-medium text-warn">{r.message}</p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {pending ? (
          <div className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ground text-[14px] font-bold text-muted">
            Booking the rest of your day…
          </div>
        ) : (
          <Link
            href="/bookings"
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-bold text-white"
          >
            See my tickets
            <ChevronIcon size={18} />
          </Link>
        )}
        {!pending && (
          <Link
            href="/explore"
            className="mt-2.5 flex h-12 w-full items-center justify-center rounded-2xl border border-line text-[14px] font-bold text-muted"
          >
            Back to home
          </Link>
        )}
      </main>
    );
  }

  // --- builder ------------------------------------------------------
  const detail = detailKey ? byKey.get(detailKey) : null;

  return (
    <>
      <main className="page-flow pt-4">
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-2.5">
          <span className="text-[13.5px] font-semibold">Who&apos;s going?</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer guests"
              disabled={guests <= MIN_GUESTS}
              onClick={() => setGuests((g) => Math.max(MIN_GUESTS, g - 1))}
              className="h-10 w-10 rounded-xl border border-line bg-surface text-lg font-bold text-brand disabled:opacity-40"
            >
              −
            </button>
            <span className="w-5 text-center text-[16px] font-bold">{guests}</span>
            <button
              type="button"
              aria-label="More guests"
              disabled={guests >= MAX_GUESTS}
              onClick={() => setGuests((g) => Math.min(MAX_GUESTS, g + 1))}
              className="h-10 w-10 rounded-xl bg-brand text-lg font-bold text-white disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
        <p className="mt-2.5 px-0.5 text-[12px] leading-relaxed font-medium text-muted">
          Add what you want for {dayLabel} on {islandName}, and the time you want it.
          We&apos;ll flag anything that can&apos;t fit together before you book.
        </p>

        {/* the day pass */}
        {lines.length === 0 ? (
          <button
            type="button"
            onClick={openBrowse}
            className="mt-4 flex w-full flex-col items-center rounded-[20px] border border-dashed border-line bg-surface/60 px-5 py-8 text-center"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-white">
              <PlusIcon size={20} />
            </span>
            <span className="mt-3 text-[14px] font-bold">Start your day</span>
            <span className="mt-1 text-[12.5px] font-medium text-navmuted">
              Pick a service, then choose what to book on {islandName}
            </span>
          </button>
        ) : (
          <div className="mt-4 rounded-[20px] border border-line bg-surface shadow-[0_2px_16px_rgba(11,36,34,0.06)]">
            <div className="flex items-center justify-between px-4 pt-4">
              <span className="font-display text-[13px] font-bold tracking-wide text-brand uppercase">
                {dayLabel}
              </span>
              <span className="text-[11px] font-bold text-navmuted">
                {lines.length} {lines.length === 1 ? "stop" : "stops"}
              </span>
            </div>

            <ul className="mt-3 flex flex-col">
              {lines.map(({ b, o }) => {
                const block = flagged(o.key, "block");
                const warn = !block && flagged(o.key, "warn");
                return (
                  <li
                    key={o.key}
                    className={`flex items-center gap-3 border-l-[3px] px-3.5 py-2.5 ${
                      block
                        ? "border-warn bg-warn/5"
                        : warn
                          ? "border-sand bg-sandsoft/40"
                          : "border-transparent"
                    }`}
                  >
                    <span className="w-[62px] shrink-0 text-[11px] font-bold text-navmuted tabular-nums">
                      {b.startsAt ? timeOf(o, b.startsAt) : "all day"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">
                        {o.mark} {o.title}
                      </span>
                      <span className="block truncate text-[11px] font-medium text-muted">
                        {o.operator}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] font-bold text-muted">
                      {linePrice(o) === 0 ? "free" : rupees(linePrice(o))}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${o.title}`}
                      onClick={() => remove(o.key)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-navmuted"
                    >
                      <CloseIcon size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>

            {activeIssues.length > 0 && (
              <ul className="mx-4 mt-1 mb-1 flex flex-col gap-1.5">
                {activeIssues.map((iss, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[11.5px] leading-snug font-semibold ${
                      iss.level === "block"
                        ? "bg-warn/10 text-warn"
                        : "bg-sandsoft text-sandink2"
                    }`}
                  >
                    <AlertIcon size={14} className="mt-px shrink-0" />
                    <span>{iss.message}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* perforation */}
            <div className="relative h-4">
              <span className="absolute top-1/2 -left-[8px] h-4 w-4 -translate-y-1/2 rounded-full border border-line bg-ground" />
              <span className="absolute top-1/2 -right-[8px] h-4 w-4 -translate-y-1/2 rounded-full border border-line bg-ground" />
              <span className="absolute inset-x-4 top-1/2 border-t border-dashed border-line" />
            </div>

            <div className="flex flex-col gap-1.5 px-4 pt-1 pb-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-bold">Pay in full now</span>
                <span className="font-display text-[17px] font-bold tracking-tight">
                  {rupees(dayTotal)}
                </span>
              </div>
              <p className="text-[10.5px] font-medium text-navmuted">
                The whole day is settled upfront — every ticket is issued straight
                away, nothing owed on the day.
              </p>
            </div>
          </div>
        )}

        {lines.length > 0 && (
          <button
            type="button"
            onClick={openBrowse}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface py-3.5 text-[13.5px] font-bold text-brand"
          >
            <PlusIcon size={16} />
            Add another stop
          </button>
        )}

        <p className="mt-4 px-0.5 text-[12px] leading-relaxed font-medium text-muted">
          One reference for the day, a separate ticket and QR for every stop. Cancel
          or change any one of them without touching the rest.
        </p>
      </main>

      {/* browse / detail sheet */}
      {browsing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center tablet:items-center">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setBrowsing(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 flex max-h-[86vh] w-full max-w-[430px] flex-col rounded-t-sheet bg-surface tablet:max-w-[520px] tablet:rounded-sheet tablet:shadow-float"
          >
            {detail ? (
              <OptionDetail
                option={detail}
                alreadyAdded={inBasket(detail.key)}
                inBasketStart={basket.find((b) => b.key === detail.key)?.startsAt ?? null}
                onBack={() => setDetailKey(null)}
                onClose={() => setBrowsing(false)}
                onAdd={(startsAt) => {
                  addOrUpdate(detail.key, startsAt);
                  setDetailKey(null);
                }}
              />
            ) : service === null ? (
              <>
                <div className="flex items-center justify-between border-b border-hairline px-5 pt-5 pb-3">
                  <div>
                    <h2 className="font-display text-[19px] font-bold tracking-tight">
                      What do you want to book?
                    </h2>
                    <p className="mt-0.5 text-[12px] font-medium text-muted">
                      Pick a service — add them in any order.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setBrowsing(false)}
                    className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted"
                  >
                    <CloseIcon size={20} />
                  </button>
                </div>

                <ul className="no-bar flex-1 overflow-y-auto px-5 py-4">
                  {SERVICES.map(({ id, label, blurb, Icon }) => {
                    const n = listFor(id).length;
                    const added = basket.filter((b) =>
                      b.key.startsWith(`${id}:`),
                    ).length;
                    return (
                      <li key={id} className="mb-2.5 last:mb-0">
                        <button
                          type="button"
                          disabled={n === 0}
                          onClick={() => setService(id)}
                          className="flex w-full items-center gap-3.5 rounded-[16px] border border-line bg-surface p-3.5 text-left disabled:opacity-45"
                        >
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brandsoft text-brand">
                            <Icon size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="text-[14.5px] font-bold">{label}</span>
                              {added > 0 && (
                                <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  {added} added
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-[11.5px] font-medium text-muted">
                              {blurb}
                            </span>
                            <span className="mt-0.5 block text-[11px] font-semibold text-navmuted">
                              {n === 0 ? "None that day" : `${n} to choose from`}
                            </span>
                          </span>
                          <ChevronIcon size={16} className="shrink-0 text-navmuted" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-hairline px-4 pt-4 pb-3">
                  <button
                    type="button"
                    aria-label="Back to services"
                    onClick={() => setService(null)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted"
                  >
                    <ChevronIcon size={17} className="rotate-180" />
                  </button>
                  <h2 className="min-w-0 flex-1 font-display text-[18px] font-bold tracking-tight">
                    {SERVICES.find((s) => s.id === service)?.label}
                  </h2>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setBrowsing(false)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center text-muted"
                  >
                    <CloseIcon size={20} />
                  </button>
                </div>

                <ul className="no-bar flex-1 overflow-y-auto px-5 pt-3 pb-6">
                  {listFor(service).length === 0 && (
                    <li className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[13px] font-medium text-muted">
                      Nothing listed for {islandName} on {dayLabel}.
                    </li>
                  )}
                  {listFor(service).map((o) => (
                    <li key={o.key} className="mb-2.5 last:mb-0">
                      <button
                        type="button"
                        onClick={() => setDetailKey(o.key)}
                        className="flex w-full items-center gap-3 rounded-[16px] border border-line bg-surface p-3.5 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-bold">
                            {o.mark} {o.title}
                          </p>
                          <p className="mt-0.5 truncate text-[11.5px] font-medium text-muted">
                            {o.operator}
                          </p>
                          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-navmuted">
                            <StarIcon size={11} className="text-sand" />
                            {o.rating}
                            <span>·</span>
                            {priceLabel(o, guests)}
                          </p>
                        </div>
                        {inBasket(o.key) ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-brandsoft px-2 py-1 text-[11px] font-bold text-brand">
                            <CheckIcon size={12} /> Added
                          </span>
                        ) : (
                          <ChevronIcon size={16} className="shrink-0 text-navmuted" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {/* consent dialog */}
      {consentOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setConsentOpen(false)}
            className="absolute inset-0 bg-ink/50"
          />
          <div
            role="alertdialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-[340px] rounded-[22px] bg-surface p-5"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sandsoft text-sandicon">
              <AlertIcon size={20} />
            </div>
            <h2 className="mt-3 font-display text-[18px] font-bold tracking-tight">
              That&apos;s a full day
            </h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {warns.map((w, i) => (
                <li key={i} className="text-[12.5px] leading-snug font-medium text-muted">
                  {w.message}
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={booking}
              onClick={() => runBook(true)}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-brand text-[14.5px] font-bold text-white disabled:opacity-60"
            >
              {booking ? "Booking…" : "Book it anyway"}
            </button>
            <button
              type="button"
              onClick={() => setConsentOpen(false)}
              className="mt-2 flex h-11 w-full items-center justify-center rounded-2xl border border-line text-[13.5px] font-bold text-muted"
            >
              Let me trim it
            </button>
          </div>
        </div>
      )}

      {/* sticky book bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface">
        <div className="page-flow flex items-center gap-3.5 pt-3 pb-[max(1.5rem,calc(var(--safe-bottom)+0.5rem))]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-brand">
              {bookError
                ? bookError
                : blocks.length > 0
                  ? "Fix the clash to book"
                  : warns.length > 0
                    ? "A packed day — we'll ask before booking"
                    : lines.length === 0
                      ? "Nothing added yet"
                      : "Paid in full — a ticket for every stop"}
            </p>
            <p className="mt-0.5 text-[19px] font-bold tracking-tight">{rupees(dayTotal)}</p>
          </div>
          <button
            type="button"
            disabled={lines.length === 0 || blocks.length > 0 || booking}
            onClick={onBook}
            className={`flex h-13 shrink-0 items-center gap-2 rounded-2xl px-5 py-3.5 text-[15px] font-bold ${
              lines.length > 0 && blocks.length === 0
                ? "bg-brand text-white"
                : "bg-ground text-muted"
            }`}
          >
            {booking ? "Booking…" : "Book the day"}
            {!booking && <ChevronIcon size={18} />}
          </button>
        </div>
      </div>
    </>
  );
}

function timeOf(option: PlanOption, startsAt: string): string {
  return option.times?.find((t) => t.startsAt === startsAt)?.timeLabel ?? "";
}

function priceLabel(o: PlanOption, guests: number): string {
  if (o.priceUnit === "day") return `${rupees(o.pricePaise)} / day`;
  if (o.pricePaise === 0) return "free entry";
  return `${rupees(o.pricePaise * guests)} for ${guests}`;
}

function OptionDetail({
  option,
  alreadyAdded,
  inBasketStart,
  onBack,
  onClose,
  onAdd,
}: {
  option: PlanOption;
  alreadyAdded: boolean;
  inBasketStart: string | null;
  onBack: () => void;
  onClose: () => void;
  onAdd: (startsAt: string | null) => void;
}) {
  const [pick, setPick] = useState<string | null>(
    inBasketStart ?? option.times?.[0]?.startsAt ?? null,
  );
  const isRide = option.kind === "ride";

  return (
    <>
      <div className="flex items-center justify-between border-b border-hairline px-5 pt-5 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex items-center gap-1 text-[13px] font-bold text-muted"
        >
          <ChevronIcon size={15} className="rotate-180" />
          Back
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mr-2 flex h-11 w-11 items-center justify-center text-muted"
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <div className="no-bar flex-1 overflow-y-auto px-5 py-4">
        <h2 className="font-display text-[19px] font-bold tracking-tight">
          {option.mark} {option.title}
        </h2>
        <p className="mt-1 text-[12.5px] font-medium text-muted">{option.operator}</p>
        <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-navmuted">
          <StarIcon size={12} className="text-sand" />
          {option.rating} · {option.reviews} reviews
        </p>

        <p className="mt-5 text-[12px] font-bold tracking-wider text-muted uppercase">
          {isRide ? "Pick-up time" : "Pick a start"}
        </p>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {option.times?.map((t) => {
            const on = t.startsAt === pick;
            const full = !isRide && t.seatsLeft <= 0;
            return (
              <button
                key={t.startsAt}
                type="button"
                disabled={full}
                onClick={() => setPick(t.startsAt)}
                className={`flex h-[56px] flex-col items-center justify-center rounded-2xl border text-center ${
                  full
                    ? "cursor-not-allowed border-line bg-ground text-muted/50"
                    : on
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-surface"
                }`}
              >
                <span className="text-[12.5px] font-bold">{t.timeLabel}</span>
                {!isRide && (
                  <span
                    className={`text-[10px] font-semibold ${
                      on ? "text-white/75" : "text-navmuted"
                    }`}
                  >
                    {full ? "full" : t.seatsLeft === Infinity ? "open" : `${t.seatsLeft} left`}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {isRide && (
          <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-line bg-ground px-4 py-3">
            <ClockIcon size={16} className="text-brand" />
            <span className="text-[12.5px] font-semibold">
              Yours for the rest of the day once you collect it — runs alongside
              everything else.
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-hairline px-5 pt-3 pb-6">
        <button
          type="button"
          disabled={!pick}
          onClick={() => onAdd(pick)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[14.5px] font-bold text-white disabled:opacity-50"
        >
          {alreadyAdded ? "Update this stop" : "Add to day"}
          <PlusIcon size={16} />
        </button>
      </div>
    </>
  );
}
