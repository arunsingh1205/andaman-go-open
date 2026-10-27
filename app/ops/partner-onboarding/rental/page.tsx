import Link from "next/link";
import { BackIcon } from "@/app/icons";
import RentalOnboardingForm from "./rental-onboarding-form";

export default function RentalOnboardingPage() {
  return (
    <>
      <Link
        href="/ops/partner-onboarding"
        className="flex items-center gap-1.5 text-[13px] font-bold text-muted"
      >
        <BackIcon size={14} />
        Categories
      </Link>

      <h1 className="font-display mt-3 text-[20px] font-bold tracking-tight">
        Onboard a scooty rental partner
      </h1>
      <p className="mt-1 text-[12.5px] font-medium text-muted">
        Creates the partner&apos;s login and their first vehicle listing in one go. Both land
        pending Andaman Go&apos;s review.
      </p>

      <RentalOnboardingForm />
    </>
  );
}
