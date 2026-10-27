"use client";

// Drop one of these on a listing's detail page. It logs a view once per
// browser session per listing (a refresh doesn't re-count) and renders
// nothing.

import { useEffect } from "react";
import { recordListingView, type ViewKind } from "@/lib/listing-views";
import { trackMeta } from "@/lib/meta-events";

export default function ViewBeacon({ kind, subject }: { kind: ViewKind; subject: string }) {
  useEffect(() => {
    const key = `viewed:${kind}:${subject}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Private mode / storage disabled — fall through and just record it.
    }
    void recordListingView(kind, subject);
    trackMeta("ViewContent", { content_type: kind, content_ids: [subject] });
  }, [kind, subject]);

  return null;
}
