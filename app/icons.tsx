type Props = { size?: number; className?: string };

function Svg({
  size = 24,
  className,
  strokeWidth = 1.6,
  children,
}: Props & { strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ScooterIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="5.5" cy="17.5" r="3" />
    <circle cx="18.5" cy="17.5" r="3" />
    <path d="M8.5 17.5h7" />
    <path d="M18.5 17.5 16 8h-2.5" />
    <path d="M5.5 17.5c0-4 2.5-7 6-7h2" />
    <path d="M11.5 6.2h3.2" />
  </Svg>
);

export const FerryIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M2.5 19.4c1.4 0 2.1-1.1 3.5-1.1s2.1 1.1 3.5 1.1 2.1-1.1 3.5-1.1 2.1 1.1 3.5 1.1 2.1-1.1 3.5-1.1" />
    <path d="M4.6 15.4 6 10.2h12l1.4 5.2" />
    <path d="M12 10.2V5.6" />
    <path d="M9.2 5.6h5.6" />
  </Svg>
);

export const DiveIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3.6 7.4h16.8v3.8a4.4 4.4 0 0 1-4.4 4.4h-1a2 2 0 0 1-1.8-1.1L12 12.6l-1.2 1.9a2 2 0 0 1-1.8 1.1h-1a4.4 4.4 0 0 1-4.4-4.4Z" />
    <path d="M20.4 9.6h1.6a1.6 1.6 0 0 1 0 3.2h-1" />
    <path d="M6 21.2c1.2 0 1.8-.9 3-.9s1.8.9 3 .9 1.8-.9 3-.9" />
  </Svg>
);

export const TableIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M7 3.2v7.4" />
    <path d="M4.4 3.2v4.2a2.6 2.6 0 0 0 5.2 0V3.2" />
    <path d="M7 10.6v10.2" />
    <path d="M17.4 3.2c-1.6 1.5-2.2 3.2-2.2 5.2s.7 2.8 2.2 2.8" />
    <path d="M17.4 3.2v17.6" />
  </Svg>
);

export const BedIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M3 19v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" />
    <path d="M3 19v1.6" />
    <path d="M21 19v1.6" />
    <path d="M3 14.4h18" />
    <path d="M6.6 14.4v-2.6a1.8 1.8 0 0 1 1.8-1.8h1.6a1.8 1.8 0 0 1 1.8 1.8v2.6" />
  </Svg>
);

export const MusicIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="6.4" cy="17.6" r="2.6" />
    <circle cx="17.6" cy="15.6" r="2.6" />
    <path d="M9 17.6V6.2l11.2-2v11.4" />
    <path d="M9 9.8 20.2 7.8" />
  </Svg>
);

export const CarIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 13.2 5 7.6a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 7.6l2 5.6" />
    <path d="M3 13.2h18v4.4a1 1 0 0 1-1 1h-1.6a1 1 0 0 1-1-1v-1H6.6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
    <path d="M6.7 16h.01M17.3 16h.01" />
  </Svg>
);

export const PlanIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.7}>
    <rect x="3.2" y="5.2" width="17.6" height="15.6" rx="3.4" />
    <path d="M8 3.2v4M16 3.2v4M3.2 10.4h17.6" />
    <path d="m12 13 .95 2.15L15.1 16l-2.15.85L12 19l-.95-2.15L8.9 16l2.15-.85z" />
  </Svg>
);

export const SunSeaIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M2 16.2c1.6 0 2.4-1.3 4-1.3s2.4 1.3 4 1.3 2.4-1.3 4-1.3 2.4 1.3 4 1.3 2.4-1.3 4-1.3" />
    <path d="M2 20.4c1.6 0 2.4-1.3 4-1.3s2.4 1.3 4 1.3 2.4-1.3 4-1.3 2.4 1.3 4 1.3 2.4-1.3 4-1.3" />
    <circle cx="12" cy="7" r="3.6" />
    <path d="M12 1.6v1M12 12.4v1M17.4 7h1M5.6 7h1" />
  </Svg>
);

export const PinIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.4" />
  </Svg>
);

export const ChatIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M21 12a8 8 0 0 1-8 8H8l-4 2 1-4a8 8 0 1 1 16-6Z" />
  </Svg>
);

export const PhoneIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M6.4 3.6h3.1l1.5 3.9-2.3 1.4a10.6 10.6 0 0 0 4.9 4.9l1.4-2.3 3.9 1.5v3.1a2 2 0 0 1-2.2 2A16.4 16.4 0 0 1 4.4 5.8a2 2 0 0 1 2-2.2Z" />
  </Svg>
);

export const MailIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <rect x="3" y="5.4" width="18" height="13.2" rx="2.6" />
    <path d="m4.2 7 7.8 5.6L19.8 7" />
  </Svg>
);

export const ChevronIcon = (p: Props) => (
  <Svg {...p} strokeWidth={2}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);

export const CheckIcon = (p: Props) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </Svg>
);

export const DownloadIcon = (p: Props) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M12 4v10" />
    <path d="m8 11 4 4 4-4" />
    <path d="M5 19.4h14" />
  </Svg>
);

export const HomeIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="m4 10.2 8-6.2 8 6.2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M9.6 21.2v-6h4.8v6" />
  </Svg>
);

export const TicketIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M4 8.4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.2a2.4 2.4 0 0 0 0 4.8v1.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.2a2.4 2.4 0 0 0 0-4.8z" />
    <path d="M13.4 6.4v11.2" strokeDasharray="2 3" />
  </Svg>
);

export const UserIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <circle cx="12" cy="8.2" r="3.5" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </Svg>
);

export const BackIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.9}>
    <path d="M19.4 12H4.6" />
    <path d="m11 18.4-6.4-6.4L11 5.6" />
  </Svg>
);

export const ShieldIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M12 3.2 5.2 6v5.4c0 4.2 2.8 7.4 6.8 9.2 4-1.8 6.8-5 6.8-9.2V6z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </Svg>
);

export const StarIcon = ({ size = 15, className }: Props) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="m12 3.4 2.6 5.4 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9z" />
  </svg>
);

export const SwapIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.9}>
    <path d="M7 4.6v14.8" />
    <path d="m3.6 16 3.4 3.4L10.4 16" />
    <path d="M17 19.4V4.6" />
    <path d="M13.6 8 17 4.6 20.4 8" />
  </Svg>
);

export const LicenceIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <rect x="3" y="5.4" width="18" height="13.2" rx="3" />
    <circle cx="8.8" cy="11.4" r="2" />
    <path d="M5.6 16.2c.6-1.5 1.8-2.2 3.2-2.2s2.6.7 3.2 2.2" />
    <path d="M14.6 10.4h4M14.6 13.8h3" />
  </Svg>
);

export const BikeIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="5.2" cy="16.8" r="3.4" />
    <circle cx="18.8" cy="16.8" r="3.4" />
    <path d="M8.6 16.8h3.2l3.4-5.6h3" />
    <path d="M5.2 16.8 9 11.2h5" />
    <path d="M14.4 7.6h3.2" />
    <path d="M15.6 11.2 14 7.6" />
  </Svg>
);

export const BicycleIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="5.5" cy="17.5" r="3.5" />
    <circle cx="18.5" cy="17.5" r="3.5" />
    <path d="M12 17.5 8.8 8.5h-2" />
    <path d="M12 17.5h6.5" />
    <path d="m12 17.5 3.5-9h2.5" />
    <path d="M10.2 8.5h5" />
  </Svg>
);

export const PlusIcon = (p: Props) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Svg>
);

export const CloseIcon = (p: Props) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Svg>
);

export const BellIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M6 9.6a6 6 0 0 1 12 0v4.2l1.6 2.6H4.4L6 13.8Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </Svg>
);

export const LogoutIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M9.6 20.4H5.2a1.6 1.6 0 0 1-1.6-1.6V5.2a1.6 1.6 0 0 1 1.6-1.6h4.4" />
    <path d="M16.4 16.4 20.8 12l-4.4-4.4" />
    <path d="M20.8 12H9.6" />
  </Svg>
);

export const MoreIcon = (p: Props) => (
  <Svg {...p} strokeWidth={2.4}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" />
  </Svg>
);

export const GearIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.7}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.6v2.6M12 18.8v2.6M4.2 7.5l2.25 1.3M17.55 15.2l2.25 1.3M4.2 16.5l2.25-1.3M17.55 8.8l2.25-1.3" />
  </Svg>
);

export const StormIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M7 16.4a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.2 3.6 3.6 0 0 1-.6 7.1" />
    <path d="m12.6 13.2-2.4 3.6h3.2l-2.4 3.6" />
  </Svg>
);

export const UndoIcon = (p: Props) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M4.5 9.5h10a5 5 0 0 1 0 10H9" />
    <path d="m8 5.5-3.5 4 3.5 4" />
  </Svg>
);

export const RefundIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="2.8" y="6.4" width="18.4" height="11.2" rx="2.2" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M6.4 12h.01M17.6 12h.01" />
  </Svg>
);

export const OfflineIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="6.6" y="2.8" width="10.8" height="18.4" rx="2.4" />
    <path d="M10.8 18.4h2.4" />
    <path d="m9.6 9.2 2.4 2.4 3.6-3.6" />
  </Svg>
);

export const QrIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.7}>
    <rect x="3.4" y="3.4" width="6.4" height="6.4" rx="1.4" />
    <rect x="14.2" y="3.4" width="6.4" height="6.4" rx="1.4" />
    <rect x="3.4" y="14.2" width="6.4" height="6.4" rx="1.4" />
    <path d="M14.2 14.2h2.6v2.6h-2.6zM18 18h2.6v2.6H18z" />
  </Svg>
);

export const AlertIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.9}>
    <path d="M12 3.6 1.8 20.4h20.4Z" />
    <path d="M12 9.6v5" />
    <path d="M12 17.4h.01" />
  </Svg>
);

export const ClockIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.2V12l3.2 2" />
  </Svg>
);

export const DashboardIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1.8" />
    <rect x="13.2" y="3.2" width="7.6" height="4.6" rx="1.8" />
    <rect x="13.2" y="10.4" width="7.6" height="10.4" rx="1.8" />
    <rect x="3.2" y="13.4" width="7.6" height="7.4" rx="1.8" />
  </Svg>
);

export const CameraIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M4 8.4a1.8 1.8 0 0 1 1.8-1.8h1.4l1-1.6h7.6l1 1.6h1.4A1.8 1.8 0 0 1 20 8.4v9.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.6Z" />
    <circle cx="12" cy="13" r="3.6" />
  </Svg>
);

export const CalendarIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <rect x="3.2" y="4.8" width="17.6" height="15.6" rx="2.6" />
    <path d="M3.2 9.6h17.6" />
    <path d="M8 3.2v3.2M16 3.2v3.2" />
  </Svg>
);

export const EarningsIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M4.4 19.2V13.4M9.6 19.2V9M14.8 19.2v-7M20 19.2V5.4" />
    <path d="M2.8 19.2h18.4" />
  </Svg>
);

export const GraphIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M3.5 4v14.5a1 1 0 0 0 1 1H20" />
    <path d="m7 14 3.5-4 3 2.5L20 6" />
  </Svg>
);

export const DirectionsIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M12 2.4 4.4 20.6l7.6-3.6 7.6 3.6Z" />
  </Svg>
);

export const SearchIcon = (p: Props) => (
  <Svg {...p} strokeWidth={2}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.35-4.35" />
  </Svg>
);

export const LinkIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M9 15 15 9" />
    <path d="M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5" />
    <path d="M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5" />
  </Svg>
);

export const ShareIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
  </Svg>
);

export const InstagramIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.5 6.5h.01" />
  </Svg>
);

// A pair of hands offering — the Community Service section mark.
export const HandsIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 7v5" />
    <path d="M9 9.5 12 7l3 2.5" />
    <path d="M3 13c1.5-1 3-1 4.5 0l3 2a3 3 0 0 0 3 0l3-2c1.5-1 3-1 4.5 0" />
    <path d="M3 13v3a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-3" />
  </Svg>
);

export const MenuIcon = (p: Props) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" />
  </Svg>
);

export const ListIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <path d="M4 6.5h.01M4 12h.01M4 17.5h.01" />
  </Svg>
);

export const HelpIcon = (p: Props) => (
  <Svg {...p} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M9.1 9.4a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
    <path d="M12 17.2h.01" />
  </Svg>
);

// The Google "G" mark — full colour, not a line icon, so it doesn't go
// through Svg (which forces a single stroke colour). Used only on the
// "Continue with Google" button.
export const GoogleIcon = ({ size = 18, className }: Props) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
    />
  </svg>
);

// The Apple mark, for "Continue with Apple" — required by App Store
// Guideline 4.8 wherever a third-party sign-in (Google, above) is offered.
export const AppleIcon = ({ size = 18, className }: Props) => (
  <svg width={size} height={size} viewBox="0 0 17 20" fill="none" className={className} aria-hidden="true">
    <path
      fill="currentColor"
      d="M14.03 10.6c-.02-2.1 1.72-3.1 1.8-3.15-.98-1.44-2.5-1.63-3.04-1.66-1.3-.13-2.52.76-3.18.76-.66 0-1.68-.74-2.76-.72-1.42.02-2.73.83-3.46 2.1-1.48 2.56-.38 6.36 1.06 8.44.7 1.02 1.54 2.16 2.64 2.12 1.06-.04 1.46-.68 2.74-.68 1.28 0 1.64.68 2.76.66 1.14-.02 1.86-1.03 2.55-2.06.8-1.18 1.13-2.33 1.15-2.39-.03-.01-2.2-.85-2.22-3.38-.02-2.12 1.73-3.13 1.8-3.17-1.1-1.6-2.8-1.66-3.14-1.68z"
    />
    <path
      fill="currentColor"
      d="M11.6 3.94c.58-.7.97-1.68.86-2.65-.83.03-1.85.55-2.45 1.24-.54.61-1 1.6-.87 2.53.92.07 1.87-.46 2.46-1.12z"
    />
  </svg>
);

// Reporting a message thread (152) — a flag, not AlertIcon's warning
// triangle, so it reads as "tell someone" rather than "something's wrong
// with the app itself".
export const FlagIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2.5 3.5L16 11H5" />
  </Svg>
);

// Blocking a message thread (152) — the universal no-entry circle, distinct
// from CloseIcon's plain X so it reads as "stop this person", not "dismiss".
export const BlockIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m6.3 6.3 11.4 11.4" />
  </Svg>
);

// Promo codes (158) — a price tag.
export const TagIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12.6 3H5.4A2.4 2.4 0 0 0 3 5.4v7.2c0 .64.25 1.25.7 1.7l8.1 8.1a2.4 2.4 0 0 0 3.4 0l5.1-5.1a2.4 2.4 0 0 0 0-3.4l-8.1-8.1a2.4 2.4 0 0 0-1.7-.7Z" />
    <circle cx="8.2" cy="8.2" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);