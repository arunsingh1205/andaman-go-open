// A "deposit" on an activity/trip/rental (034) is exactly that listing's own
// operator's commission (partners.commission_bps, migration 138) — the same
// "pay the commission now, the rest in person" shape cabs (073) and stays
// (097) always used, generalised to every category once commission stopped
// being one flat rate everyone shared (137). DEPOSIT_RATE is only the
// last-resort fallback for the rare case a partner's own commission_bps
// somehow reads back null — every listing already has an approved, so a
// non-null rate, before this ever gets used for real.
export const DEPOSIT_RATE = 0.3;

/** @deprecated Use paymentSplit(pricePaise, "deposit", bps) with the
 *  listing's own operator's commission_bps — a deposit is no longer one
 *  flat rate. Kept only as the fallback figure paymentSplit falls back to. */
export function depositFor(totalPaise: number): number {
  return Math.round(totalPaise * DEPOSIT_RATE);
}

// Commission is negotiated per business (partners.commission_bps, migration
// 137), not one fixed rate per category — so there is no longer a single
// "the" cab or stay commission to read. These two constants are only the
// last-resort indicative figures for the handful of screens that show a
// split before any specific operator/property is known (e.g. onboarding a
// brand-new cab partner), or as a fallback if a specific partner's own
// commission_bps somehow reads back null.
export const CAB_COMMISSION_BPS_FALLBACK = 1500;

// Independent of cabs' fallback above — don't conflate the two.
export const STAY_COMMISSION_BPS_FALLBACK = 2000;

/** How a booking was paid: the whole price now, or a deposit — that
 *  listing's own operator's commission, paid now — with the balance owed in
 *  person. */
export type PayMode = "full" | "deposit";
