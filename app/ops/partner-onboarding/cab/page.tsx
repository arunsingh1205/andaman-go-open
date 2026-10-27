import Link from "next/link";
import { BackIcon } from "@/app/icons";
import { CAB_COMMISSION_BPS_FALLBACK } from "@/lib/pricing";
import CabOnboardingForm from "./cab-onboarding-form";

export default async function CabOnboardingPage() {
  return (
    <>
      <Link
        href="/ops/partner-onboarding"
        className="flex items-center gap-1.5 text-[13px] font-bold text-muted"
      >
        <BackIcon size={14} />
        Categories
      </Link>

      <h1 className="font-display mt-3 text-[20px] font-bold tracking-tight">Onboard a cab partner</h1>
      <p className="mt-1 text-[12.5px] font-medium text-muted">
        Creates the partner&apos;s login and their first cab listing in one go. Both land pending
        Andaman Go&apos;s review.
      </p>

      <CabOnboardingForm commissionBps={CAB_COMMISSION_BPS_FALLBACK} />
    </>
  );
}
