"use client";

// The photo strip at the top of a listing. One photo shows as a still; several
// become a scroll-snap carousel — swipe on a phone, trackpad-swipe or tap a dot
// on a laptop. From `lg` there are also prev / next arrows for mouse users.

import { useRef, useState } from "react";
import Image from "next/image";
import { ChevronIcon } from "./icons";

export default function PhotoCarousel({ photos, alt }: { photos: string[]; alt: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  if (photos.length === 0) return null;

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  const goTo = (n: number) => {
    const el = trackRef.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl border border-line bg-ground lg:rounded-panel">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="no-bar flex snap-x snap-mandatory overflow-x-auto"
      >
        {photos.map((src, n) => (
          <div key={src} className="relative aspect-[4/3] w-full shrink-0 snap-center lg:aspect-[16/10]">
            <Image
              src={src}
              alt={alt}
              fill
              draggable={false}
              priority={n === 0}
              sizes="(min-width: 1024px) 660px, (min-width: 768px) 430px, 100vw"
              className="object-cover"
            />
          </div>
        ))}
      </div>

      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
            className="absolute top-1/2 left-3 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-brand shadow-raised transition hover:bg-white disabled:pointer-events-none disabled:opacity-0 lg:flex"
          >
            <ChevronIcon size={18} className="rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            disabled={index === photos.length - 1}
            onClick={() => goTo(index + 1)}
            className="absolute top-1/2 right-3 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-brand shadow-raised transition hover:bg-white disabled:pointer-events-none disabled:opacity-0 lg:flex"
          >
            <ChevronIcon size={18} />
          </button>
        </>
      )}

      {photos.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
          {photos.map((src, n) => (
            <button
              key={src}
              type="button"
              aria-label={`Photo ${n + 1} of ${photos.length}`}
              aria-current={n === index}
              onClick={() => goTo(n)}
              className={`pointer-events-auto h-1.5 rounded-full transition-all ${
                n === index ? "w-4 bg-white" : "w-1.5 bg-white/55"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
