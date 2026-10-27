// Plain constants describing partner categories — split out of
// partner-register.ts because a "use server" file can only export async
// functions, and these are looked up client-side too.

// "restaurant" is kept here (not offered at registration any more, 095) so
// existing restaurant partners still render correctly in admin's partner
// list/detail screens — their business rows are untouched, only the active
// registration/self-manage paths are gone.
export type PartnerKind = "dive" | "ferry" | "restaurant" | "rental" | "venue" | "cab" | "host" | "stay";

export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = {
  dive: "Water sports / diving",
  ferry: "Ferry operator",
  restaurant: "Restaurant",
  rental: "Scooter / bike rental",
  venue: "Event venue",
  cab: "Cab / car rental",
  host: "Day trips / local host",
  stay: "Stay / homestay",
};

/** Human label for a broadcast's target (lib/admin-broadcasts.ts, 110) —
 *  "Every partner" or, e.g., "Ferry operator". Lives here rather than in
 *  admin-broadcasts.ts because that's a "use server" file, which can only
 *  export async functions (same reason PARTNER_KIND_LABEL above isn't
 *  inside partner-register.ts either — see that file's own header comment). */
export function recipientKindLabel(kind: PartnerKind | null): string {
  return kind ? PARTNER_KIND_LABEL[kind] : "Every partner";
}

// A license matters most for water-sports operators — Arun's own words were
// "the big one is activity" — so this is the one category the registration
// form insists on it for. Every other category can add one later if asked.
export const KIND_NEEDS_LICENSE: Partial<Record<PartnerKind, boolean>> = {
  dive: true,
};
