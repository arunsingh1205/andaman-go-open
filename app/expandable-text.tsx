"use client";

// A long "about" paragraph, collapsed to 4 lines with a "See more" toggle —
// the standard e-commerce/booking-app pattern, so a listing page reads as
// "here's the short version, book if you're ready" instead of a wall of
// text somebody has to scroll past before they ever reach the price.

import { useEffect, useRef, useState } from "react";

export default function ExpandableText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Only offer "See more" once the text actually overflows 4 lines — a
  // short "about" shouldn't grow a toggle that reveals nothing new.
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    setCanExpand(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div>
      <p ref={ref} className={`${className} ${expanded ? "" : "line-clamp-4"}`}>
        {text}
      </p>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[12.5px] font-bold text-brand"
        >
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </div>
  );
}
