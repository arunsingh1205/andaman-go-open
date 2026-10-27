import Link from "next/link";
import { getOpsSession } from "@/lib/ops-auth";
import { signOutOps } from "@/lib/ops-signout";

// Scoped to cabs and scooty rentals only — the two categories where the
// partner is least likely to get through self-serve Google/email sign-up
// on their own. Every other category still registers itself the normal way
// at /partner/not-linked.
const CATEGORIES: { slug: string; label: string }[] = [
  { slug: "cab", label: "Cab" },
  { slug: "rental", label: "Scooty rental" },
];

export default async function PartnerOnboardingPage() {
  const session = await getOpsSession();

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-tight">Onboard a partner</h1>
          <p className="mt-1 text-[13px] font-medium text-muted">
            {session?.email ? `Signed in as ${session.email}` : ""}
          </p>
        </div>
        <form action={signOutOps}>
          <button
            type="submit"
            className="h-10 rounded-xl border border-line bg-surface px-4 text-[13px] font-bold text-ink"
          >
            Sign out
          </button>
        </form>
      </div>

      <p className="mt-4 text-[13.5px] leading-relaxed font-medium text-muted">
        Pick the category that matches what the partner is offering.
      </p>

      <div className="mt-6 flex flex-col gap-2.5">
        {CATEGORIES.map((c) => (
          <Link
            key={c.slug}
            href={`/ops/partner-onboarding/${c.slug}`}
            className="flex h-14 items-center rounded-xl border border-line bg-surface px-4 text-[14.5px] font-bold text-ink"
          >
            {c.label}
          </Link>
        ))}
      </div>
    </>
  );
}
