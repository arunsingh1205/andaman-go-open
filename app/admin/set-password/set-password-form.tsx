"use client";

// The admin-console twin of app/partner/set-password/set-password-form.tsx
// — same token_hash + verifyOtp exchange (see that file's comment for why:
// it sidesteps the PKCE-vs-hash-fragment redirect ambiguity the raw
// action_link has), same two-field form. Two differences: no
// clear_must_reset_password call (that flag, and the RPC that clears it,
// are partner-specific — admins have no equivalent), and it lands on
// /admin/overview afterward instead of /partner/business.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Stage = "verifying" | "ready" | "invalid" | "saving" | "done";

export default function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get("token_hash");
  const tokenType = searchParams.get("type");
  const hasValidLink = Boolean(tokenHash) && tokenType === "recovery";

  const [stage, setStage] = useState<Stage>(hasValidLink ? "verifying" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!hasValidLink || !tokenHash) return;

    supabaseBrowser.auth
      .verifyOtp({ token_hash: tokenHash, type: "recovery" })
      .then(({ error }) => setStage(error ? "invalid" : "ready"));
  }, [hasValidLink, tokenHash]);

  const submit = async () => {
    if (password.length < 8) {
      setProblem("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setProblem("Passwords don't match.");
      return;
    }

    setStage("saving");
    setProblem(null);

    const { error: updateError } = await supabaseBrowser.auth.updateUser({ password });
    if (updateError) {
      setProblem("Couldn't save that password. Try again.");
      setStage("ready");
      return;
    }

    setStage("done");
    router.push("/admin/overview");
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

      <h1 className="font-display mt-6 text-[24px] font-bold tracking-tight">Set your password</h1>

      {stage === "verifying" && (
        <p className="mt-3 text-[13.5px] font-medium text-muted">Checking your link…</p>
      )}

      {stage === "invalid" && (
        <p className="mt-3 text-[13.5px] leading-relaxed font-medium text-warn">
          This link has expired or was already used. Ask whoever set up your access to send a
          fresh one.
        </p>
      )}

      {(stage === "ready" || stage === "saving") && (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed font-medium text-muted">
            Choose a password for your Andaman Go admin account.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-bold text-muted">New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-bold text-muted">Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="••••••••"
                className="h-12 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand"
              />
            </label>

            {problem && <p className="text-[12.5px] font-medium text-warn">{problem}</p>}

            <button
              type="button"
              disabled={stage === "saving"}
              onClick={submit}
              className="mt-2 h-13 w-full rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              {stage === "saving" ? "Saving…" : "Save and continue"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
