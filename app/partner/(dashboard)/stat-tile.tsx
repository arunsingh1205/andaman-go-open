// Shared icon-chip stat tile — the mobile app's visual signature for any
// "number in a card" (Dashboard's daily counts, Earnings' time windows).
// Desktop keeps the original plain card look untouched via the desk: overrides.

import type { CheckIcon } from "@/app/icons";

export const ACCENT_CHIP: Record<"teal" | "orange" | "purple" | "coral", { bg: string; fg: string }> = {
  teal: { bg: "#E3F4F1", fg: "#1F8A80" },
  orange: { bg: "#FFF1DC", fg: "#D9962B" },
  purple: { bg: "#E8EAFF", fg: "#5B6CFF" },
  coral: { bg: "#FFE4DB", fg: "#FF7A59" },
};

export function IconChip({
  accent,
  Icon,
}: {
  accent: keyof typeof ACCENT_CHIP;
  Icon: typeof CheckIcon;
}) {
  const chip = ACCENT_CHIP[accent];
  return (
    <span
      className="mb-3 flex h-8 w-8 items-center justify-center rounded-[11px] desk:hidden"
      style={{ background: chip.bg, color: chip.fg }}
    >
      <Icon size={16} />
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone,
  accent,
  Icon,
  desktopValuePx = 26,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "brand" | "warn" | "sand";
  accent: "teal" | "orange" | "purple" | "coral";
  Icon: typeof CheckIcon;
  // The Dashboard tile's original desktop numeral size (26px). Screens whose
  // pre-refresh desktop layout used a different size (e.g. Earnings' 20px)
  // pass their own, so this shared tile never changes an untouched desktop.
  desktopValuePx?: 20 | 26;
}) {
  const desktopToneText = tone === "warn" ? "desk:text-warn" : tone === "sand" ? "desk:text-sandicon" : "desk:text-brand";
  const desktopValueSize = desktopValuePx === 20 ? "desk:text-[20px]" : "desk:text-[26px]";

  return (
    <div className="rounded-[24px] border border-line bg-surface p-5 shadow-none desk:rounded-2xl desk:p-4 desk:shadow-sm">
      <IconChip accent={accent} Icon={Icon} />
      <p
        className={`text-[30px] leading-none font-extrabold text-brand desk:font-display desk:font-bold ${desktopValueSize} ${desktopToneText}`}
      >
        {value}
      </p>
      <p className="mt-2 text-[13px] font-medium text-muted desk:text-[11.5px] desk:leading-tight desk:font-bold">
        {label}
      </p>
      {sub && <p className="mt-0.5 text-[11px] font-semibold text-muted">{sub}</p>}
    </div>
  );
}
