// Exact SVG paths from the onboarding design (sign in / sign up / register
// business) — kept separate from app/icons.tsx because those are the app's
// general icon set and these exist purely to match this one design 1:1.

type Props = { size?: number; className?: string };

function Glyph({ d, size = 18, className }: Props & { d: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

export const MailGlyph = (p: Props) => <Glyph {...p} d="M4 4h16v16H4zM4 6l8 7 8-7" />;
export const LockGlyph = (p: Props) => <Glyph {...p} d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" />;
export const UserGlyph = (p: Props) => (
  <Glyph {...p} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
);
export const ChevronLeftGlyph = (p: Props) => <Glyph {...p} d="m15 18-6-6 6-6" />;
export const CheckGlyph = (p: Props) => <Glyph {...p} d="M20 6 9 17l-5-5" />;
export const ArrowRightGlyph = (p: Props) => <Glyph {...p} d="M5 12h14M13 6l6 6-6 6" />;
export const BuildingGlyph = (p: Props) => (
  <Glyph {...p} d="M4 7h16v13H4zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M4 13h16" />
);
export const PinGlyph = (p: Props) => (
  <Glyph {...p} d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
);
