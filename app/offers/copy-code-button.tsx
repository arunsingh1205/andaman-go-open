"use client";

// Copy-to-clipboard for an offer card's code — the only bit of this page
// that needs to be a client component.

import { useState } from "react";
import { CheckIcon } from "@/app/icons";

export default function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) —
      // the code is still right there on the card to type by hand.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[12.5px] font-bold transition ${
        copied ? "border-brand bg-brand text-white" : "border-line bg-surface text-brand"
      }`}
    >
      {copied ? (
        <>
          <CheckIcon size={14} />
          Copied
        </>
      ) : (
        "Copy code"
      )}
    </button>
  );
}
