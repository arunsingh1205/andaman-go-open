"use client";

import { ISLANDS, useIsland } from "@/lib/island-context";
import { SunSeaIcon } from "./icons";

export default function IslandPicker() {
  const { island, setIslandId } = useIsland();

  return (
    <>
      {/* The island switch lives in the desktop navbar from `lg` (desktop-nav.tsx).

          flex-auto, not flex-1: three equal thirds left "Sri Vijaya Puram" a
          pixel short of fitting and it alone wrapped to two lines. Sized by
          their own text, all three names fit on one line down to a 360px
          phone. */}
      <div className="mt-4.5 flex gap-2 lg:hidden">
        {ISLANDS.map((i) => {
          const on = i.id === island.id;
          return (
            <button
              key={i.id}
              type="button"
              aria-pressed={on}
              onClick={() => setIslandId(i.id)}
              className={`flex min-h-11 flex-auto items-center justify-center rounded-xl border px-1.5 py-1.5 text-center text-[12px] leading-tight font-semibold ${
                on
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-muted"
              }`}
            >
              {i.name}
            </button>
          );
        })}
      </div>

      <div
        className={`mt-3 flex items-center gap-3 rounded-card px-4 py-3.5 lg:order-2 lg:mt-7 lg:w-fit lg:max-w-[520px] lg:pr-6 ${
          island.calm ? "bg-brandsoft text-brand" : "bg-sandsoft text-sandink"
        }`}
      >
        <SunSeaIcon size={24} className="shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-wider uppercase opacity-70">
            Sea report today
          </p>
          <p className="mt-0.5 text-[13.5px] leading-snug font-semibold">{island.line}</p>
        </div>
      </div>

      <h2 className="font-display mt-6 text-[27px] leading-tight font-bold tracking-tight lg:order-1 lg:mt-0 lg:text-hero">
        What&apos;s the plan
        <br />
        in {island.full}?
      </h2>
    </>
  );
}
