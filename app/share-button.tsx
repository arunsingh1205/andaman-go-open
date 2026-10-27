"use client";

// A single share icon for a listing's header, next to PageBack — the
// counterpart to app/share-row.tsx's three-button row (WhatsApp/Instagram/
// copy), for pages that just want one tap into the OS share sheet rather
// than a dedicated "Share this" section. Same navigator.share()-first,
// copy-link-fallback logic as ShareRow's Instagram button.
//
// `text` is what invites the tap to turn into a booking — "Ride into the
// mangroves on Havelock — book it on Andaman Go", not just a bare title —
// since most share targets (WhatsApp, Messages) show this ahead of the URL.

import { useState } from "react";
import { ShareIcon } from "@/app/icons";

export default function ShareButton({
  title,
  text,
  className = "",
}: {
  title: string;
  /** Defaults to `${title} — book it on Andaman Go` when omitted. */
  text?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    const shareText = text ?? `${title} — book it on Andaman Go`;

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: shareText, url });
        return;
      } catch (err) {
        // AbortError means the person closed the share sheet themselves —
        // a completed interaction, not a failure to fall back from.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context, permissions) — nothing
      // more to fall back to here.
    }
  };

  return (
    // className (e.g. ml-auto, to pin this to the right of a header row
    // even when PageBack next to it is display:none on iOS native) has to
    // land on this outer span — it's the actual flex item in the caller's
    // row, not the inner button.
    <span className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        aria-label="Share"
        onClick={share}
        className="flex h-11 w-11 items-center justify-center text-ink"
      >
        <ShareIcon size={20} />
      </button>
      {copied && (
        <span className="absolute top-full right-0 z-10 mt-1 rounded-lg bg-ink px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap text-white">
          Link copied
        </span>
      )}
    </span>
  );
}
