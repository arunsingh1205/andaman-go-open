"use client";

// What sits at the bottom of Profile: "Log in" or "Log out", never both.
//
// Everyone has an account here — SessionBoot hands each visitor an anonymous
// one so a booking has a real owner from the first tap. But an anonymous
// account is not something you can log back in to, so offering "Log out" on
// one was offering to destroy it: the old copy said as much, and the next
// page load silently issued a fresh blank account anyway. That reads as
// logging out and instantly back in as nobody.
//
// So while the session is anonymous this is an invitation to make the account
// real. Once a number is attached it becomes an ordinary log out, and it
// means what people expect it to mean, because logging back in returns the
// same bookings.

import { useState } from "react";
import SignInSheet from "@/app/sign-in-sheet";
import LogOutButton from "./log-out-button";
import { LogoutIcon, UserIcon } from "@/app/icons";
import { prettyPhone } from "@/lib/phone";

export default function AccountRow({
  isAnonymous,
  phone,
}: {
  isAnonymous: boolean;
  phone: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (!isAnonymous) {
    return (
      <>
        <div className="mt-7 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-brandsoft text-brand">
            <UserIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-muted">Logged in as</p>
            <p className="mt-0.5 truncate text-[14px] font-bold">
              {phone ? prettyPhone(phone) : "Your account"}
            </p>
          </div>
        </div>
        <LogOutButton />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 text-[14.5px] font-bold text-white"
      >
        <LogoutIcon size={18} />
        Log in
      </button>
      <p className="mt-2 text-center text-[12px] leading-relaxed font-medium text-muted">
        Your bookings live on this device right now. Add your number and
        they&apos;ll be there on any phone you open the app on.
      </p>

      {open && <SignInSheet onClose={() => setOpen(false)} />}
    </>
  );
}
