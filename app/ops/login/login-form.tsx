"use client";

// Same two ways in as the admin side — Google, or email + password — and the
// same honesty about who this is for: there is no ops sign-up link here,
// ever. Signing in with an account nobody has linked to `ops_users` just
// lands on /ops/not-linked with no way forward from there either.

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { GoogleIcon } from "@/app/icons";

export default function OpsLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const continueWithGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);

    const { error } = await supabaseBrowser.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/ops/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) {
      setProblem("Couldn't reach Google. Try again.");
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy || email.trim() === "" || password === "") return;

    setBusy(true);
    setProblem(null);

    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setProblem("That email and password don't match. Check them and try again.");
      setBusy(false);
      return;
    }

    router.push("/ops/partner-onboarding");
  };

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

      <h1 className="font-display mt-6 text-[24px] font-bold tracking-tight">Ops sign in</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed font-medium text-muted">
        For onboarding partners on-site. This is not a self-service area.
      </p>

      <button
        type="button"
        onClick={continueWithGoogle}
        disabled={busy}
        className="mt-7 flex h-13 w-full items-center justify-center gap-2.5 rounded-2xl border border-line bg-surface text-[14.5px] font-bold text-ink disabled:opacity-50"
      >
        <GoogleIcon size={18} />
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] font-bold tracking-wider text-muted uppercase">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-muted">Email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="you@andamango.com"
            aria-label="Email"
            className="h-12 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-muted">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••••"
            aria-label="Password"
            className="h-12 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand"
          />
        </label>

        {problem && <p className="text-[12.5px] font-medium text-warn">{problem}</p>}

        <button
          type="button"
          disabled={busy || email.trim() === "" || password === ""}
          onClick={submit}
          className="mt-2 h-13 w-full rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
