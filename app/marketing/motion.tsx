"use client";

// The marketing page's motion engine: one scroll listener for the whole page.
//
// It does three things, all by writing attributes and CSS variables that
// home.module.css reads — there is no animation library:
//
//   data-motion="on"   on the page root, once we know we can animate. Every
//                      "hidden until revealed" rule in the stylesheet hangs
//                      off this, so a reader with no JS or with
//                      prefers-reduced-motion gets the finished page.
//   data-in            on each [data-reveal] element the first time it
//                      scrolls into view.
//   --p (0 → 1)        on each [data-progress] element, its scroll progress:
//                      "view" — from entering the viewport to leaving it
//                      "exit" — from the top of the page to scrolled past
//                      "pin"  — through a tall section with a sticky stage
//
// Reveals are checked from the scroll handler rather than an
// IntersectionObserver on purpose: observer callbacks are throttled, sometimes
// indefinitely, in a backgrounded or occluded tab, and content hidden behind
// a callback that may never fire is not an acceptable trade.

import { useEffect } from "react";

export default function Motion({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    root.dataset.motion = "on";

    let pending = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const tracked = Array.from(root.querySelectorAll<HTMLElement>("[data-progress]"));
    let frame = 0;

    const update = () => {
      frame = 0;
      const vh = window.innerHeight;

      root.toggleAttribute("data-scrolled", window.scrollY > 24);

      if (pending.length) {
        pending = pending.filter((el) => {
          if (el.getBoundingClientRect().top > vh * 0.9) return true;
          el.dataset.in = "";
          return false;
        });
      }

      for (const el of tracked) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) continue;
        const mode = el.dataset.progress;
        const p =
          mode === "pin"
            ? -r.top / Math.max(1, r.height - vh)
            : mode === "exit"
              ? -r.top / Math.max(1, r.height)
              : (vh - r.top) / (vh + r.height);
        el.style.setProperty("--p", Math.min(1, Math.max(0, p)).toFixed(4));
      }
    };

    const queue = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    queue();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    return () => {
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      if (frame) cancelAnimationFrame(frame);
      delete root.dataset.motion;
    };
  }, [rootId]);

  return null;
}
