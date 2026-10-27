"use client";

// Share buttons for a listing page: WhatsApp, Instagram, copy link.
//
// The URL is read from window.location at click time, so there's nothing to
// render on the server and no hydration mismatch — and it always shares the
// exact page the person is looking at. All three are buttons (not anchors) for
// the same reason: the href would differ between server and client.
//
// Instagram has no web share-intent for an arbitrary link the way wa.me does
// for WhatsApp (you can only deep link into the app's own composer, not hand
// it a URL). Where the OS has a real share sheet — navigator.share(), which
// Capacitor's iOS WKWebView and every modern mobile browser support — this
// hands the link to that instead: Instagram (Direct, or Story on platforms
// that register for it) shows up as a real target the person taps, same as
// any other app that can receive a shared link. Only where there's no share
// sheet at all (desktop, or a WebView build without one) does this fall back
// to the older, honest-but-manual move: copy the link and open
// instagram.com, with a note to paste it into a story or bio.

import { useState } from "react";
import { ChatIcon, InstagramIcon, LinkIcon } from "@/app/icons";

const btn =
  "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface text-[13px] font-bold text-brand transition active:scale-[0.985]";

type Flash = "copied" | "instagram" | null;

export default function ShareRow({ title }: { title: string }) {
  const [flash, setFlash] = useState<Flash>(null);

  const currentUrl = () => (typeof window === "undefined" ? "" : window.location.href);

  const flashFor = (kind: Exclude<Flash, null>) => {
    setFlash(kind);
    window.setTimeout(() => setFlash((f) => (f === kind ? null : f)), 2500);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl());
      return true;
    } catch {
      // Clipboard can be blocked (insecure context, permissions).
      return false;
    }
  };

  const openWhatsApp = () => {
    const text = encodeURIComponent(`${title} — ${currentUrl()}`);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  };

  const openInstagram = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url: currentUrl() });
        return;
      } catch (err) {
        // AbortError means the person closed the share sheet themselves —
        // that's a completed interaction, not a failure to fall back from.
        // Anything else (no share target chose to open, a sandboxed iframe)
        // falls through to the manual copy-and-open below.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
    await copyLink();
    flashFor("instagram");
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mt-6">
      <p className="text-[12px] font-bold tracking-wider text-muted uppercase">Share this</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={openWhatsApp} className={btn}>
          <ChatIcon size={16} />
          WhatsApp
        </button>
        <button type="button" onClick={openInstagram} className={btn}>
          <InstagramIcon size={16} />
          Instagram
        </button>
        <button
          type="button"
          onClick={() => {
            void copyLink();
            flashFor("copied");
          }}
          className={btn}
        >
          <LinkIcon size={16} />
          {flash === "copied" ? "Copied!" : "Copy link"}
        </button>
      </div>
      {flash === "instagram" && (
        <p className="mt-2 text-[11.5px] font-medium text-muted">
          Link copied — paste it into your story or bio.
        </p>
      )}
    </div>
  );
}
