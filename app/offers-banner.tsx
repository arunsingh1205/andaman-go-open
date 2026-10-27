// A plain link, not a button-with-modal like PlanBanner — there's nothing
// to configure first, /offers is the whole destination (160).

import Link from "next/link";
import { ChevronIcon, TagIcon } from "./icons";

export default function OffersBanner() {
  return (
    <Link
      href="/offers"
      className="card-hover mt-3 flex items-center gap-3.5 rounded-card border border-line bg-surface p-4 text-left transition active:scale-[0.98] lg:active:scale-100"
    >
      <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-brandsoft text-brand">
        <TagIcon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold">Offers</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug font-medium text-muted">
          Current discount codes — activities and island adventures.
        </span>
      </span>
      <ChevronIcon size={20} className="shrink-0 text-muted" />
    </Link>
  );
}
