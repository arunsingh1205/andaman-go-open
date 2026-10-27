import { Suspense } from "react";
import Image from "next/image";
import SetPasswordForm from "./set-password-form";

// Where a staff member lands from the "set your password" link an owner
// sends them (lib/admin-staff.ts inviteStaff()) — the admin-console twin of
// app/partner/set-password/page.tsx. Same <Suspense> boundary for the same
// reason: set-password-form.tsx's useSearchParams() forces client
// rendering, and Next needs a boundary above it to contain that bailout.
export default function AdminSetPasswordPage() {
  return (
    <Suspense fallback={<SetPasswordShell />}>
      <SetPasswordForm />
    </Suspense>
  );
}

function SetPasswordShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col justify-center px-6">
      <Image
        sizes="164px"
        src="/brand/andaman-go-light-mode.png"
        alt="Andaman Go"
        width={1600}
        height={234}
        priority
        className="h-6 w-auto self-center"
      />

      <h1 className="font-display mt-6 text-[24px] font-bold tracking-tight">Set your password</h1>

      <p className="mt-3 text-[13.5px] font-medium text-muted">Checking your link…</p>
    </div>
  );
}
