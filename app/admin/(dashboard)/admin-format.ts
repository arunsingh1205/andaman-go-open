// Plain formatting helpers for the admin console — split out of admin-ui.tsx
// because that file is "use client", and a server component (like the
// Overview page) can't call a function exported from a client module, only
// pass its result through as a prop.

/** Paise to a rupee string — money is integer paise everywhere in this app. */
export function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}
