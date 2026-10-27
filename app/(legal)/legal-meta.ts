// One place for the dates that appear at the top of every policy page.
//
// Deliberately a hand-set constant rather than new Date(): "Last updated" has
// to mean "when this policy last changed", not "when this page was served". A
// date that moves on every deploy tells a reader — and a payments reviewer —
// nothing, and quietly claims a policy was revised when it wasn't.
//
// Change the date on a line ONLY when that page's wording changes.
export const LAST_UPDATED = {
  terms: "22 September 2026",
  privacy: "19 September 2026",
  refunds: "22 September 2026",
  shipping: "6 September 2026",
  // Keep this in step with v_terms_version in supabase/137 — it is the
  // agreement version a partner is recorded as having accepted at signup.
  partnerAgreement: "22 September 2026",
} as const;

// The registered business, in one place so an address change is a single edit.
export const BUSINESS = {
  operator: "Arun Singh",
  tradingAs: "Andaman Go",
  email: "support@andamango.in",
  partnerEmail: "partner@andamango.in",
  phone: "+91 94760 33302",
  phoneHref: "+919476033302",
  addressLines: [
    "Near Ayush Store, South Point",
    "Sri Vijaya Puram, South Andaman",
    "Andaman & Nicobar Islands 744106",
    "India",
  ],
  hours: "9:00 – 19:00 IST, all days",
} as const;
