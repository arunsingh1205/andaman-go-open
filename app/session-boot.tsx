"use client";

// Gives every visitor an identity the moment the app opens, before they have
// any idea they need one.
//
// It renders nothing. It exists so that by the time somebody taps a Book
// button, the session is already there and the button responds instantly
// rather than pausing to invent an account.

import { useEffect } from "react";
import { ensureSession } from "@/lib/supabase-browser";

export default function SessionBoot() {
  useEffect(() => {
    ensureSession().catch((error: unknown) => {
      // A failure here is not worth interrupting anybody over — the app is
      // perfectly usable without a session until the moment they book, and
      // booking calls ensureSession() again and shows this properly.
      console.error("[andaman-go] session:", error);
    });
  }, []);

  return null;
}
