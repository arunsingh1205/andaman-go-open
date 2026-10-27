import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnBusiness } from "@/lib/partner-register";
import { getPartnerOnboarding } from "@/lib/partner-onboarding";
import { PARTNER_KIND_LABEL } from "@/lib/partner-kind";
import { CheckGlyph, ArrowRightGlyph } from "../onboarding-icons";

// Landed on right after registerPartner() succeeds (see
// not-linked/register-form.tsx) — the moment between "just registered" and
// "working the dashboard". Shown once: nothing links back here, so a partner
// only ever sees it the one time they finish setup.
export default async function PartnerWelcomePage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const business = await getOwnBusiness(session.partnerId);
  if (!business) redirect("/partner/not-linked");

  const onboarding = await getPartnerOnboarding(session.partnerId);
  const statusLabel = business.status === "approved" ? "Live" : "Pending";

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#0F4C5C] text-white">
      <div className="pointer-events-none absolute top-[38%] left-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1F8A80] opacity-35" />
      <div className="pointer-events-none absolute top-[38%] left-1/2 h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1F8A80] opacity-45" />
      <div className="pointer-events-none absolute top-[120px] right-[30px] h-[14px] w-[14px] rounded-full bg-[#F4B860]" />
      <div className="pointer-events-none absolute top-[250px] left-[44px] h-[10px] w-[10px] rounded-full bg-[#FF7A59]" />
      <div className="pointer-events-none absolute bottom-[360px] right-10 h-2 w-2 rounded-full bg-[#7FD1C5]" />

      <div className="relative mx-auto flex w-full max-w-[430px] flex-1 flex-col px-7 py-10">
        <div className="flex justify-center">
          <Image
            sizes="123px"
            src="/brand/andaman-go-dark-mode.png"
            alt="Andaman Go"
            width={1600}
            height={234}
            className="h-[18px] w-auto"
          />
        </div>

        <div className="mt-auto flex flex-col items-center pb-6 text-center">
          <span className="flex h-28 w-28 items-center justify-center rounded-full bg-[#7FD1C5] shadow-xl">
            <CheckGlyph size={48} className="text-[#0F4C5C]" />
          </span>

          <p className="mt-9 text-[12px] font-bold tracking-widest text-[#7FD1C5] uppercase">
            You&rsquo;re in
          </p>
          <h1 className="mt-2.5 text-[28px] leading-[1.15] font-extrabold tracking-[-1.2px]">
            Welcome aboard,
            <br />
            {business.name}
          </h1>
          <p className="mt-3.5 max-w-[300px] text-[14px] leading-[1.55] text-[#A9DDD5]">
            Your partner account is ready. Add your listings and set opening hours to start
            receiving bookings.
          </p>

          <div className="mt-7 flex w-full gap-2.5">
            {onboarding && (
              <div className="flex flex-1 flex-col items-center gap-1 rounded-2xl border border-white/[0.14] bg-white/[0.08] px-3 py-3.5">
                <span className="text-[22px] leading-tight font-extrabold tracking-[-0.5px] text-[#7FD1C5]">
                  {onboarding.doneCount}/{onboarding.total}
                </span>
                <span className="text-[11px] font-semibold text-[#A9DDD5]">Setup done</span>
              </div>
            )}
            <div className="flex flex-1 flex-col items-center gap-1 rounded-2xl border border-white/[0.14] bg-white/[0.08] px-3 py-3.5">
              <span className="text-[13px] leading-tight font-extrabold text-[#F4B860]">
                {PARTNER_KIND_LABEL[business.kind]}
              </span>
              <span className="text-[11px] font-semibold text-[#A9DDD5]">Business type</span>
            </div>
            <div className="flex flex-1 flex-col items-center gap-1 rounded-2xl border border-white/[0.14] bg-white/[0.08] px-3 py-3.5">
              <span className="text-[22px] leading-tight font-extrabold text-white">{statusLabel}</span>
              <span className="text-[11px] font-semibold text-[#A9DDD5]">Status</span>
            </div>
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <Link
            href="/partner/dashboard"
            className="flex h-[58px] w-full items-center justify-center gap-2 rounded-[18px] bg-[#7FD1C5] text-[16px] font-extrabold text-[#0F4C5C] shadow-[0_12px_30px_rgba(0,0,0,0.25)]"
          >
            Go to dashboard
            <ArrowRightGlyph size={18} />
          </Link>
          <Link
            href="/partner/business/new"
            className="flex h-[58px] w-full items-center justify-center rounded-[18px] border border-white/[0.16] text-[14.5px] font-bold text-[#A9DDD5]"
          >
            Add listing
          </Link>
        </div>
      </div>
    </div>
  );
}
