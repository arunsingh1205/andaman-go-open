"use client";

// Booking an event needs the same thing a real door does: a name for every
// guest, and their age, because kids FREE_UNDER_AGE and under don't need a
// ticket — they're free and don't count against capacity. Everyone older
// does. The ticketed count (and so the price) is worked out here, from ages,
// before create_booking is ever called — see bookEvent() in lib/book.ts.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bookEvent, type EventGuest } from "@/lib/book";
import { ensureSession } from "@/lib/supabase-browser";
import { chargeViaRazorpay, makeReceipt, MIN_CHARGE_PAISE } from "@/lib/razorpay-client";
import { rupees } from "@/lib/activities";
import { FREE_UNDER_AGE, seatsLeft, type EventItem } from "@/lib/events";
import { ChevronIcon } from "@/app/icons";

const MAX_GUESTS = 10;
const MAX_PASSES = 10;

type Draft = { fullName: string; age: string };
const emptyDraft = (): Draft => ({ fullName: "", age: "" });

const label = "text-[11.5px] font-bold text-muted";
const nameInput =
  "h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand";
const ageInput =
  "h-11 w-16 shrink-0 rounded-xl border border-line bg-surface px-2.5 text-center text-[14px] font-semibold outline-none focus:border-brand";

export default function RsvpPanel({ event }: { event: EventItem }) {
  const router = useRouter();
  const left = seatsLeft(event);
  const soldOut = left === 0;

  const tiered = event.tickets.length > 0;
  const [ticketId, setTicketId] = useState(event.tickets[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const ticket = event.tickets.find((t) => t.id === ticketId) ?? event.tickets[0];

  const [drafts, setGuests] = useState<Draft[]>(() => Array.from({ length: 2 }, emptyDraft));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // With passes, the head count is fixed by what was picked: every person a
  // pass admits is a guest, kids included. Without, it's whatever the
  // traveller sets, and kids FREE_UNDER_AGE and under don't need a ticket.
  const people = tiered && ticket ? ticket.people * qty : drafts.length;
  const guests = Array.from({ length: people }, (_, i) => drafts[i] ?? emptyDraft());

  const setCount = (n: number) => {
    const next = Math.max(1, Math.min(MAX_GUESTS, n));
    setGuests((prev) =>
      next > prev.length
        ? [...prev, ...Array.from({ length: next - prev.length }, emptyDraft)]
        : prev.slice(0, next),
    );
  };

  const setGuest = (i: number, patch: Partial<Draft>) =>
    setGuests((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(emptyDraft());
      next[i] = { ...next[i], ...patch };
      return next;
    });

  const ages = guests.map((g) => parseInt(g.age, 10));
  const ticketed = tiered
    ? people
    : ages.filter((a) => !isNaN(a) && a > FREE_UNDER_AGE).length;
  const total = tiered && ticket ? ticket.pricePaise * qty : event.entryPaise * ticketed;
  const free = total === 0;

  const agesValid = ages.every((a) => !isNaN(a) && a >= 0 && a <= 120);
  const namesValid = guests.every((g) => g.fullName.trim() !== "");
  const overCapacity = ticketed > left;
  const ready = !soldOut && namesValid && agesValid && ticketed >= 1 && !overCapacity;

  const rsvp = async () => {
    if (!ready || busy) return;

    setBusy(true);
    setProblem(null);

    const guestList: EventGuest[] = guests.map((g) => ({
      fullName: g.fullName.trim(),
      age: parseInt(g.age, 10),
    }));

    try {
      await ensureSession();

      const razorpay =
        total < MIN_CHARGE_PAISE
          ? undefined
          : await chargeViaRazorpay({
              amountPaise: total,
              receipt: makeReceipt(`event-${event.slug}`),
              description: event.name,
            });

      const result = await bookEvent({
        kind: "event",
        subject: event.slug,
        startsAt: event.startsAt,
        party: ticketed,
        ...(tiered && ticket ? { variant: ticket.id, units: qty } : {}),
        guests: guestList,
        razorpay,
      });

      if (!result.ok) {
        setProblem(result.message);
        setBusy(false);
        return;
      }

      const passQuery =
        tiered && ticket ? `&pass=${encodeURIComponent(ticket.name)}&qty=${qty}` : "";
      router.push(`/booked?type=event&id=${event.slug}&n=${people}&ref=${result.ref}${passQuery}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <div className="mt-8">
      <h2 className="text-[12px] font-bold tracking-wider text-muted uppercase">
        Who&apos;s coming?
      </h2>

      {soldOut ? (
        <p className="mt-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
          Every spot has gone. Try another night on the Events list.
        </p>
      ) : (
        <>
          {tiered && (
            <div className="mt-3 flex flex-col gap-2">
              {event.tickets.map((t) => {
                const picked = t.id === ticket?.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTicketId(t.id)}
                    className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left ${
                      picked ? "border-brand bg-brandsoft" : "border-line bg-surface"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-bold">{t.name}</span>
                      <span className="block text-[12px] font-medium text-muted">
                        {t.people === 1 ? "1 person" : `${t.people} people`}
                        {t.description ? ` · ${t.description}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[15px] font-bold">
                      {t.pricePaise === 0 ? "Free" : rupees(t.pricePaise)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-2.5">
            <span className="text-[14px] font-semibold">
              {tiered ? `${ticket?.name ?? "Tickets"}` : "Guests"}
            </span>
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                disabled={(tiered ? qty : guests.length) <= 1}
                onClick={() => (tiered ? setQty(qty - 1) : setCount(guests.length - 1))}
                className="h-11 w-11 rounded-xl border border-line bg-ground text-lg font-bold text-brand disabled:opacity-40"
              >
                −
              </button>
              <span className="w-5 text-center text-[17px] font-bold">
                {tiered ? qty : guests.length}
              </span>
              <button
                type="button"
                disabled={tiered ? qty >= MAX_PASSES : guests.length >= MAX_GUESTS}
                onClick={() => (tiered ? setQty(qty + 1) : setCount(guests.length + 1))}
                className="h-11 w-11 rounded-xl bg-brand text-lg font-bold text-white disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed font-medium text-muted">
            {tiered
              ? `${people} ${people === 1 ? "person" : "people"} in total — add everyone's name below.`
              : `Kids ${FREE_UNDER_AGE} and under go free and don't need a ticket — everyone older does.`}
          </p>

          <div className="mt-3 flex flex-col gap-2.5">
            {guests.map((g, i) => {
              const age = parseInt(g.age, 10);
              const kid = !tiered && !isNaN(age) && age <= FREE_UNDER_AGE && g.age.trim() !== "";
              return (
                <div key={i} className="rounded-2xl border border-line bg-surface p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-brand">Guest {i + 1}</span>
                    {kid && (
                      <span className="rounded-full bg-brandsoft px-2 py-0.5 text-[10.5px] font-bold text-brand">
                        Free — no ticket
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className={label}>Full name</span>
                      <input
                        value={g.fullName}
                        onChange={(e) => setGuest(i, { fullName: e.target.value })}
                        placeholder="e.g. Arjun Rao"
                        className={nameInput}
                      />
                    </label>
                    <label className="flex shrink-0 flex-col gap-1">
                      <span className={label}>Age</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={g.age}
                        onChange={(e) => setGuest(i, { age: e.target.value })}
                        className={ageInput}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          {overCapacity && (
            <p className="mt-2 text-[11.5px] font-medium text-warn">
              {tiered
                ? `Only ${left} spot${left === 1 ? "" : "s"} left for this event — your selection covers ${people}.`
                : `Only ${left} ticket${left === 1 ? "" : "s"} left for this event — that's ${ticketed} of your guests over ${FREE_UNDER_AGE}.`}
            </p>
          )}
        </>
      )}

      <div className="mt-6 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[13.5px] text-muted">
            {tiered && ticket
              ? free
                ? `${qty} × ${ticket.name} · free entry`
                : `${rupees(ticket.pricePaise)} × ${qty} ${ticket.name}`
              : event.entryPaise === 0
                ? `${ticketed} ticket${ticketed === 1 ? "" : "s"} · free entry`
                : `${rupees(event.entryPaise)} × ${ticketed} ticket${ticketed === 1 ? "" : "s"}`}
          </span>
          <span className="text-[17px] font-bold">{total === 0 ? "Free" : rupees(total)}</span>
        </div>

        {problem && (
          <p className="mb-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
            {problem}
          </p>
        )}

        <button
          type="button"
          disabled={!ready || busy}
          onClick={rsvp}
          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold ${
            ready && !busy ? "bg-brand text-white" : "bg-line text-muted"
          }`}
        >
          {busy
            ? "Booking…"
            : soldOut
              ? "Sold out"
              : free
                ? "RSVP"
                : "Book entry"}
          {!soldOut && !busy && <ChevronIcon size={18} />}
        </button>

        <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
          {soldOut
            ? "Every spot has gone. Try another night on the Events list."
            : "Pay now, entry confirmed instantly."}
        </p>
      </div>
    </div>
  );
}
