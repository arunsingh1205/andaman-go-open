import { Suspense } from "react";
import Image from "next/image";
import SetPasswordForm from "./set-password-form";

// A server component whose only job is to be the <Suspense> boundary that
// set-password-form.tsx's useSearchParams() needs — see the note there.
// Everything the partner actually interacts with lives in that file.
//
// The fallback is the form's own "verifying" state, byte for byte, so the
// swap from prerendered shell to hydrated form is invisible: same logo, same
// heading, same line of copy in the same place.
export default function SetPasswordPage() {
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
