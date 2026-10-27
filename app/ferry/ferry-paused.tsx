// What a traveller sees at /ferry while FERRY_BOOKING_ENABLED (lib/ferries.ts)
// is off — an honest "not right now" instead of either a 404 (confusing for
// anyone who bookmarked or was sent the link) or, worse, a booking flow that
// quietly can't be fulfilled. Existing ferry bookings and the admin
// placement queue are completely untouched; this only stops new ones.

import Link from "next/link";
import BottomNav from "@/app/bottom-nav";
import PageBack from "@/app/page-back";
import { ChatIcon, FerryIcon } from "@/app/icons";

export default function FerryPaused() {
  return (
    <>
      <main className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-32 lg:pt-10 lg:pb-24">
        <PageBack href="/explore" variant="text" label="Home" />

        <div className="mt-10 flex flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brandsoft text-brand">
            <FerryIcon size={30} />
          </span>
          <h1 className="font-display mt-4 text-[20px] font-bold tracking-tight">
            Ferry booking is paused
          </h1>
          <p className="mt-2 max-w-[360px] text-[13.5px] leading-relaxed text-muted">
            We don&apos;t have a live seat count from the operators right now, and with how many
            people are trying to travel between islands this week, we&apos;d rather pause bookings
            than risk taking your money for a seat we can&apos;t actually hold.
          </p>

          <a
            href="https://wa.me/919933272581"
            className="mt-6 flex items-center gap-2 rounded-2xl bg-brand px-5 py-3 text-[14px] font-bold text-white"
          >
            <ChatIcon size={17} />
            WhatsApp us for a ferry
          </a>
          <p className="mt-2 text-[12px] font-medium text-muted">
            A real person checks with the operators directly — 7 AM to 11 PM.
          </p>

          <Link
            href="/explore"
            className="mt-6 text-[12.5px] font-bold text-brand underline underline-offset-2"
          >
            See what else you can book
          </Link>
        </div>
      </main>

      <BottomNav />
    </>
  );
}
