"use client";

// Apply-a-code field (158, scope/percent/minimum-order 160) — Activities
// and Trips only, for now. Checks the code with validate_promo_code
// (read-only, doesn't redeem anything) so the panel can show "₹200 off"
// before the traveller pays; the parent panel owns subtracting that from
// its own total. The actual redemption only happens inside create_booking,
// at the moment of payment — see lib/promo.ts.

import { useEffect, useRef, useState } from "react";
import { rupees } from "@/lib/activities";
import { validatePromoCode } from "@/lib/promo";

export default function PromoCodeField({
  kind,
  subject,
  orderPaise,
  onApplied,
}: {
  kind: "activity" | "trip";
  subject: string;
  /** The pre-discount total right now — a percent code's amount, and a
   *  minimum-order check, are both computed against this. */
  orderPaise: number;
  onApplied: (code: string | null, discountPaise: number) => void;
}) {
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<{ code: string; discountPaise: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A percent discount (or a minimum-order check) was computed against
  // orderPaise at the moment "Apply" was pressed. If the guest count (or
  // anything else feeding orderPaise) changes afterwards, that number is
  // stale — clear the applied code rather than keep showing a discount
  // that no longer matches what's actually being booked. Re-applying is
  // one tap, and this is the same "don't trust a quantity that moved"
  // instinct create_booking's own re-checks already follow server-side.
  const appliedAtOrderPaise = useRef<number | null>(null);
  useEffect(() => {
    if (applied && appliedAtOrderPaise.current !== null && appliedAtOrderPaise.current !== orderPaise) {
      setApplied(null);
      setError("Your total changed — reapply the code.");
      onApplied(null, 0);
    }
    // onApplied is a fresh closure from the parent every render; only
    // orderPaise actually changing should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderPaise]);

  const apply = async () => {
    const typed = code.trim();
    if (typed === "" || busy) return;

    setBusy(true);
    setError(null);
    const result = await validatePromoCode(typed, kind, subject, orderPaise);
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    appliedAtOrderPaise.current = orderPaise;
    setApplied({ code: typed.toUpperCase(), discountPaise: result.discountPaise });
    onApplied(typed.toUpperCase(), result.discountPaise);
  };

  const remove = () => {
    appliedAtOrderPaise.current = null;
    setApplied(null);
    setCode("");
    setError(null);
    onApplied(null, 0);
  };

  if (applied) {
    return (
      <div className="mt-3 flex items-center justify-between rounded-xl border border-brand bg-brandsoft px-3.5 py-2.5">
        <span className="text-[13px] font-bold text-brand">
          {applied.code} applied — {rupees(applied.discountPaise)} off
        </span>
        <button
          type="button"
          onClick={remove}
          className="text-[12px] font-bold text-brand underline"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          placeholder="Promo code"
          aria-label="Promo code"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold uppercase outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={code.trim() === "" || busy}
          onClick={apply}
          className={`h-11 shrink-0 rounded-xl px-4 text-[13.5px] font-bold ${
            code.trim() !== "" && !busy ? "bg-brand text-white" : "bg-line text-muted"
          }`}
        >
          {busy ? "Checking…" : "Apply"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] font-medium text-sandink2">{error}</p>}
    </div>
  );
}
