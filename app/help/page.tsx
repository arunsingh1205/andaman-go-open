import type { Metadata } from "next";
import BottomNav from "@/app/bottom-nav";
import { ChatIcon, ShieldIcon } from "@/app/icons";
import HelpFaq from "./help-faq";

export const metadata: Metadata = {
  title: "Help & support — Andaman Go",
  description:
    "Answers about booking, payments, cancellations and refunds on Andaman Go, plus WhatsApp and phone support from a real person on the islands.",
  alternates: { canonical: "/help" },
};

export default function HelpPage() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-4 lg:pt-10 lg:pb-6">
          <h1 className="font-display text-[22px] lg:text-page font-bold tracking-tight">Help</h1>
          <p className="mt-0.5 text-[12px] font-medium text-muted">
            We usually reply within 30 minutes
          </p>
        </div>
      </div>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-12">
        <div className="lg:col-span-5">
        <a
          href="https://wa.me/919933272581"
          className="flex gap-3 rounded-[18px] border border-line bg-surface p-4 transition active:scale-[0.985]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brandsoft text-brand">
            <ChatIcon size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-bold">Chat with support</p>
            <p className="mt-0.5 text-[12px] leading-snug font-medium text-muted">
              WhatsApp us your booking reference — a real person picks it up, 7 AM to 11 PM.
            </p>
            <p className="mt-1.5 text-[12.5px] font-bold text-brand">+91 99332 72581</p>
          </div>
        </a>

        <a
          href="tel:+919933272581"
          className="mt-2.5 flex gap-3 rounded-[18px] border border-sandline bg-sandsoft p-4 transition active:scale-[0.985]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-sand text-white">
            <ShieldIcon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-bold text-sandink">Weather emergency line</p>
            <p className="mt-0.5 text-[12px] leading-snug font-medium text-sandink2">
              If a sailing is cancelled for weather, call this number — it&apos;s staffed even
              when the app can&apos;t book you a fix.
            </p>
            <p className="mt-1.5 text-[12.5px] font-bold text-sandink">+91 99332 72581</p>
          </div>
        </a>
        </div>

        <div className="lg:col-span-7 lg:[&>:first-child]:mt-0">
        <h2 className="mt-7 text-[12px] font-bold tracking-wider text-muted uppercase">
          Common questions
        </h2>
        <HelpFaq />
        </div>
      </main>

      <BottomNav />
    </>
  );
}
