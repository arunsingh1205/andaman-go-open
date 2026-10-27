"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOutAdmin } from "@/lib/admin-signout";

export default function AdminNotLinkedSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    await signOutAdmin();
    router.replace("/admin/login");
  };

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="mt-6 h-12 rounded-xl border border-line bg-surface px-5 text-[13.5px] font-bold text-ink disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
