"use client";

import { useState } from "react";
import { ChevronIcon } from "@/app/icons";

const FAQS = [
  {
    q: "Can I cancel or change a booking?",
    a: "Free ferries and tables can be changed any time before the slot. Paid activities can be cancelled up to 24 hours before for a full refund; after that, the deposit is non-refundable. For cabs, the amount you paid online isn't refundable, but you can cancel any time — let the driver know so they don't make the trip.",
  },
  {
    q: "When do I get my ferry ticket?",
    a: "Once your ferry booking is paid, we place the seats with the operator — Makruzz, Nautika or Green Ocean — and your PNR and ticket arrive on WhatsApp, usually within a few hours. Carry the same photo ID you entered for each passenger.",
  },
  {
    q: "Do I pay now or later?",
    a: "It depends on the booking. Tables and free events cost nothing up front. Activities and rentals take a deposit at booking, with the rest due in person. For a cab, you pay a booking fee online and the rest to the driver, or pay the full fare online.",
  },
  {
    q: "What happens if the sea is rough?",
    a: "If a ferry or water activity is cancelled for weather, everything booked after it in the same day plan moves automatically — you don't need to rebook each piece separately.",
  },
  {
    q: "Do I need a licence for a scooter?",
    a: "Yes, for scooters and bikes — a valid driving licence is checked at pick-up. Cycles need no licence. Upload yours in Profile to speed up pick-up.",
  },
  {
    q: "Can I change island or dates after booking?",
    a: "Yes — message support with your reference and the new dates. Ferry and activity bookings can usually be moved for free if there are open seats.",
  },
];

export default function HelpFaq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <ul className="mt-3 flex flex-col gap-2.5">
      {FAQS.map((f, i) => {
        const open = openIndex === i;
        return (
          <li
            key={f.q}
            className="rounded-[18px] border border-line bg-surface"
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenIndex(open ? null : i)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              <span className="min-w-0 flex-1 text-[14px] font-bold">{f.q}</span>
              <ChevronIcon
                size={18}
                className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
              />
            </button>
            {open && (
              <p className="px-4 pb-4 text-[13px] leading-relaxed text-muted">{f.a}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
