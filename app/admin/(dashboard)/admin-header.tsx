"use client";

// The phone-only top bar. On desktop the sidebar carries the brand mark and
// the sign-out button, so this whole strip disappears at md — it exists so
// the phone layout isn't left with a bottom tab strip and no way out.

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signOutAdmin } from "@/lib/admin-signout";
import { LogoutIcon } from "@/app/icons";

export default function AdminHeader() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    await signOutAdmin();
    router.replace("/admin/login");
  };

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-surface md:hidden">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <Image
          sizes="36px"
          src="/brand/icon-192.png"
          alt=""
          width={192}
          height={192}
          className="h-9 w-9 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-[15px] leading-tight font-bold tracking-tight">
            Andaman Go
          </p>
          <p className="text-[10px] font-bold tracking-wider text-muted uppercase">Admin console</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          aria-label="Sign out"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line text-muted disabled:opacity-50"
        >
          <LogoutIcon size={17} />
        </button>
      </div>
    </div>
  );
}
