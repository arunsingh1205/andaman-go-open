// "WhatsApp" and "Call" buttons for reaching an operator directly.
//
// WhatsApp opens with a message already typed — after a booking that's the
// ticket code and the traveller's own number, so the operator knows which
// booking it's about without asking. Plain anchors, no JS: wa.me and tel:
// both hand off to the phone's own apps.

import { ChatIcon, PhoneIcon } from "@/app/icons";

/**
 * A phone string a person typed → the digits wa.me wants (country code, no +).
 * Assumes India when there's no country code, since that's every operator here.
 * Null when there aren't enough digits to be a number.
 */
export function toWaNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(1);
  return digits; // already carries a country code
}

const linkClass =
  "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface text-[13px] font-bold text-brand transition active:scale-[0.985]";

export default function OperatorContact({
  phone,
  whatsappText,
  className,
}: {
  phone: string | null;
  whatsappText: string;
  className?: string;
}) {
  const wa = toWaNumber(phone);
  if (!wa) return null;

  return (
    <div className={className ?? "flex gap-2"}>
      <a
        href={`https://wa.me/${wa}?text=${encodeURIComponent(whatsappText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        <ChatIcon size={16} />
        WhatsApp
      </a>
      <a href={`tel:+${wa}`} className={linkClass}>
        <PhoneIcon size={16} />
        Call
      </a>
    </div>
  );
}
