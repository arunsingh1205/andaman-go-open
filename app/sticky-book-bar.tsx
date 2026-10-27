"use client";

// A price + CTA bar pinned to the bottom of a detail page — the same shape the
// scooty and trips screens use, so every detail page reads the same on any
// device. It doesn't book anything itself: the button scrolls to the on-page
// panel (#book), which owns the real flow.

export default function StickyBookBar({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface lg:hidden">
      <div className="page-well flex items-center gap-3 pt-3 pb-[max(1.5rem,calc(var(--safe-bottom)+0.75rem))]">
        <div className="min-w-0 flex-1">
          {hint && <p className="truncate text-[11px] font-semibold text-muted">{hint}</p>}
          <p className="mt-0.5 truncate text-[15px] font-bold">{label}</p>
        </div>
        <button
          type="button"
          onClick={() =>
            document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="shrink-0 rounded-2xl bg-brand px-6 py-3 text-[14px] font-bold text-white"
        >
          Book
        </button>
      </div>
    </div>
  );
}
