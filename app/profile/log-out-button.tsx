"use client";

// Signing out ends the anonymous session. Bookings made on it stay in the
// database but become unreachable from this device — only the WhatsApp
// reference code gets you back to them (see lib/supabase-browser.ts). So this
// asks twice and says why.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ensureSession, supabaseBrowser } from "@/lib/supabase-browser";
import { LogoutIcon } from "@/app/icons";

export default function LogOutButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    await supabaseBrowser.auth.signOut();
    // SessionBoot only hands out a fresh anonymous identity once, on the
    // very first mount — a client-side nav right after logging out (this
    // one) doesn't remount it. Without this, the app sits with no session at
    // all until something else happens to need one, so any bookable screen
    // visited in between would look signed-out rather than "anonymous, same
    // as before you ever logged in."
    await ensureSession().catch((error: unknown) => {
      console.error("[andaman-go] session:", error);
    });
    router.replace("/explore");
    router.refresh();
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface py-3.5 text-[14.5px] font-bold text-warn"
      >
        <LogoutIcon size={18} />
        Log out
      </button>
    );
  }

  return (
    <div className="mt-7 rounded-2xl border border-sandline bg-sandsoft p-4">
      <p className="text-[12.5px] leading-relaxed font-medium text-sandink2">
        Log out and this device forgets your bookings — you&apos;d need the
        reference code we sent on WhatsApp to find them again.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={signOut}
          className="h-11 flex-1 rounded-xl bg-warn text-[13.5px] font-bold text-white disabled:opacity-60"
        >
          {busy ? "Logging out…" : "Log out anyway"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="h-11 rounded-xl border border-line bg-surface px-4 text-[13.5px] font-bold text-ink disabled:opacity-50"
        >
          Stay
        </button>
      </div>
    </div>
  );
}
