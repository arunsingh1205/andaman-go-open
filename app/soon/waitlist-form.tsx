"use client";

// Posts to /api/waitlist, which bypasses the coming-soon gate (it's under
// /api/*) and inserts into the waitlist table (057-waitlist.sql). RLS on
// that table is the actual write boundary — this form is just the friendly
// front end for it.

import { useState, type FormEvent } from "react";
import s from "./soon.module.css";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === "busy" || status === "done") return;
    setStatus("busy");
    setMessage(null);

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setStatus("error");
        setMessage(data?.message ?? "Something went wrong — try again in a moment.");
        return;
      }

      setStatus("done");
    } catch {
      setStatus("error");
      setMessage("Something went wrong — try again in a moment.");
    }
  };

  if (status === "done") {
    return (
      <p className={s.done} role="status">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M20 6 9 17l-5-5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        You&apos;re on the list — we&apos;ll email you at launch.
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate={false}>
      <div className={s.form}>
        <label htmlFor="waitlist-email" className="sr-only">
          Email address
        </label>
        <input
          id="waitlist-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className={s.field}
        />
        <button type="submit" disabled={status === "busy"} className={s.submit}>
          <span className={s.label}>{status === "busy" ? "Joining…" : "Join the waitlist"}</span>
          <span className={s.sheen} aria-hidden />
        </button>
      </div>
      {message && (
        <p className={s.error} role="alert">
          {message}
        </p>
      )}
    </form>
  );
}
