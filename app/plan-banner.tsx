"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_GUESTS, MAX_GUESTS, MIN_GUESTS, planDayChoices } from "@/lib/day-plan";
import { ISLANDS, islandSlug, type IslandId } from "@/lib/islands";
import { useIsland } from "@/lib/island-context";
import { ChevronIcon, CloseIcon, PlanIcon } from "./icons";

const HEADINGS: Record<number, { title: string; sub: string }> = {
  1: { title: "Which island?", sub: "The day you're planning happens on one island." },
  2: { title: "Which day?", sub: "Pick the day you want to spend out." },
  3: { title: "Who's it for?", sub: "We'll size fares and tables to match." },
};

export default function PlanBanner() {
  const router = useRouter();
  const { island: current } = useIsland();
  const days = useMemo(() => planDayChoices(), []);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [islandId, setIslandId] = useState<IslandId>(current.id);
  const [dayKey, setDayKey] = useState(days[0].key);
  const [guests, setGuests] = useState(DEFAULT_GUESTS);

  const start = () => {
    setStep(1);
    setIslandId(current.id);
    setDayKey(days[0].key);
    setGuests(DEFAULT_GUESTS);
    setOpen(true);
  };

  const go = () =>
    router.push(
      `/plan?island=${islandSlug(islandId)}&day=${dayKey}&guests=${guests}`,
    );

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="card-hover mt-3 flex w-full items-center gap-3.5 rounded-card border border-brand bg-brand p-4 text-left text-white transition active:scale-[0.98] lg:mt-0 lg:gap-4 lg:p-6 lg:active:scale-100"
      >
        <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white">
          <PlanIcon size={24} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-white">Plan my day</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug font-medium text-white/80">
            Build your day from what&apos;s on the island — we&apos;ll flag anything that
            can&apos;t fit together.
          </span>
        </span>
        <ChevronIcon size={20} className="shrink-0 text-white/70" />
      </button>

      {open && (
        // A bottom sheet on phones, a centred dialog on desktop.
        <div className="fixed inset-0 z-50 flex items-end justify-center tablet:items-center">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />

          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-[430px] rounded-t-sheet bg-surface tablet:max-w-[480px] tablet:rounded-sheet tablet:shadow-float"
          >
            <div className="flex items-start gap-3 border-b border-hairline px-5 pt-5 pb-4">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-[19px] font-bold tracking-tight">
                  {HEADINGS[step].title}
                </h2>
                <p className="mt-0.5 text-[12.5px] font-medium text-muted">
                  {HEADINGS[step].sub}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            {step === 1 && (
              <div className="px-5 py-5">
                <ul className="flex flex-col gap-2.5">
                  {ISLANDS.map((i) => {
                    const on = i.id === islandId;
                    return (
                      <li key={i.id}>
                        <button
                          type="button"
                          onClick={() => setIslandId(i.id)}
                          aria-pressed={on}
                          className={`flex w-full items-center justify-between rounded-2xl border-[1.5px] px-4 py-3 text-left ${
                            on ? "border-brand bg-brandsoft" : "border-line bg-surface"
                          }`}
                        >
                          <span>
                            <span className="block text-[14.5px] font-bold">{i.name}</span>
                            <span className="block text-[11.5px] font-medium text-muted">
                              {i.former}
                            </span>
                          </span>
                          <span
                            className={`h-4 w-4 rounded-full border-[5px] ${
                              on ? "border-brand" : "border-line"
                            }`}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-bold text-white"
                >
                  Next
                  <ChevronIcon size={18} />
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="px-5 py-5">
                <ul className="grid grid-cols-2 gap-2.5">
                  {days.map((d) => {
                    const on = d.key === dayKey;
                    return (
                      <li key={d.key}>
                        <button
                          type="button"
                          onClick={() => setDayKey(d.key)}
                          aria-pressed={on}
                          className={`flex w-full flex-col items-start rounded-2xl border-[1.5px] px-3.5 py-3 text-left ${
                            on ? "border-brand bg-brandsoft" : "border-line bg-surface"
                          }`}
                        >
                          <span className="text-[14px] font-bold">{d.weekday}</span>
                          <span className="mt-0.5 text-[11.5px] font-medium text-muted">
                            {d.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-4 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex h-13 shrink-0 items-center justify-center rounded-2xl border border-line px-5 text-[14px] font-bold text-muted"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="flex h-13 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-bold text-white"
                  >
                    Next
                    <ChevronIcon size={18} />
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="px-5 py-5">
                <div className="flex items-center justify-between rounded-2xl border border-line bg-ground px-4 py-2.5">
                  <span className="text-[14px] font-semibold">How many people?</span>
                  <div className="flex items-center gap-3.5">
                    <button
                      type="button"
                      disabled={guests <= MIN_GUESTS}
                      onClick={() => setGuests((g) => Math.max(MIN_GUESTS, g - 1))}
                      className="h-11 w-11 rounded-xl border border-line bg-surface text-lg font-bold text-brand disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-[17px] font-bold">{guests}</span>
                    <button
                      type="button"
                      disabled={guests >= MAX_GUESTS}
                      onClick={() => setGuests((g) => Math.min(MAX_GUESTS, g + 1))}
                      className="h-11 w-11 rounded-xl bg-brand text-lg font-bold text-white disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="flex h-13 shrink-0 items-center justify-center rounded-2xl border border-line px-5 text-[14px] font-bold text-muted"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={go}
                    className="flex h-13 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-bold text-white"
                  >
                    Build my day
                    <ChevronIcon size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
