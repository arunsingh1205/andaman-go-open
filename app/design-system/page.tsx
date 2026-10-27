import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import * as Icons from "@/app/icons";
import { CheckIcon, ChevronIcon, ClockIcon, PinIcon, PlanIcon, ShieldIcon, StarIcon } from "@/app/icons";

// The living version of design-system/README.md: every swatch, size and
// component below is drawn with the real tokens from app/globals.css, so if a
// token changes this page changes with it. Internal reference only — it 404s
// on the production deployment and is never indexed.
export const metadata: Metadata = {
  title: "Design system — Andaman Go",
  robots: { index: false, follow: false },
};

export const dynamic = "force-static";

const COLORS: {
  group: string;
  note: string;
  items: { token: string; hex: string; role: string; dark?: boolean; outline?: boolean }[];
}[] = [
  {
    group: "Ground & surface",
    note: "Cool off-white ground with white cards. Cards read by border, not shadow.",
    items: [
      { token: "ground", hex: "#F2F6F5", role: "Page background, inset wells, input fill on the navbar", outline: true },
      { token: "surface", hex: "#FFFFFF", role: "Cards, navbar, sheets, inputs", outline: true },
      { token: "line", hex: "#E2EAE8", role: "Card and input borders, skeleton bars", outline: true },
      { token: "hairline", hex: "#EEF3F2", role: "Dividers inside a card, sidebar edge", outline: true },
    ],
  },
  {
    group: "Ink",
    note: "Text is deep teal-black, never pure black.",
    items: [
      { token: "ink", hex: "#0B2422", role: "Headlines, primary text", dark: true },
      { token: "muted", hex: "#5C7370", role: "Secondary text, captions, inactive controls", dark: true },
      { token: "navmuted", hex: "#93A8A5", role: "Inactive tab icons, tertiary meta", dark: true },
    ],
  },
  {
    group: "Brand teal",
    note: "The one action colour. Sampled off the logo lockup so chrome and mark match.",
    items: [
      { token: "brand", hex: "#13434C", role: "Primary buttons, links, selected state, footer band", dark: true },
      { token: "brandsoft", hex: "#E4F0EE", role: "Selected row fill, icon wells, active nav pill", outline: true },
      { token: "brandmint", hex: "#7FD1C5", role: "Only on dark brand surfaces, where brandsoft has no contrast" },
    ],
  },
  {
    group: "Sand",
    note: "Warm counterpoint: the sales CTA on dark grounds, and anything about the sea, plans and cautions.",
    items: [
      { token: "sand", hex: "#D9A05B", role: "Marketing CTA, star fill, Plan-my-day icon tile" },
      { token: "sandsoft", hex: "#FBF1E4", role: "Banner fill (sea report when choppy, Plan my day)", outline: true },
      { token: "sandline", hex: "#EEDCC0", role: "Border of a sand banner", outline: true },
      { token: "sandink", hex: "#6E4210", role: "Text on sandsoft", dark: true },
      { token: "sandink2", hex: "#8A5B22", role: "Secondary text on sandsoft", dark: true },
      { token: "sandicon", hex: "#B0783A", role: "Chevrons and icons on sandsoft", dark: true },
    ],
  },
  {
    group: "Signal",
    note: "One warning colour, used for scarcity ('3 left') and destructive confirmation.",
    items: [{ token: "warn", hex: "#C2601F", role: "Seats-left, alerts, destructive text", dark: true }],
  },
];

const TYPE_ROLES: {
  role: string;
  spec: string;
  phone: string;
  sample: React.ReactNode;
}[] = [
  {
    role: "Hero",
    spec: "Bricolage 700 · 48px / 1.04 · −0.03em",
    phone: "27px",
    sample: <p className="font-display text-hero font-bold">What&apos;s the plan in Swaraj Dweep?</p>,
  },
  {
    role: "Page title",
    spec: "Bricolage 700 · 34px / 1.1 · −0.025em",
    phone: "22px",
    sample: <p className="font-display text-page font-bold">Your bookings</p>,
  },
  {
    role: "Section title",
    spec: "Bricolage 700 · 24px · −0.02em",
    phone: "12px overline",
    sample: <p className="font-display text-[24px] font-bold tracking-tight">Popular in Swaraj Dweep</p>,
  },
  {
    role: "Card title",
    spec: "Jakarta 700 · 16.5px / 1.25",
    phone: "15px",
    sample: <p className="text-[16.5px] font-bold">Rent a scooty</p>,
  },
  {
    role: "Body",
    spec: "Jakarta 500 · 14–15px / 1.6 · muted",
    phone: "14px",
    sample: (
      <p className="max-w-[52ch] text-[14.5px] leading-relaxed font-medium text-muted">
        Book a room or a whole homestay directly with the host — pay the booking fee now and the rest on arrival.
      </p>
    ),
  },
  {
    role: "Caption",
    spec: "Jakarta 500–600 · 12–13px · muted",
    phone: "12px",
    sample: <p className="text-[13px] font-medium text-muted">Scooters &amp; bikes by the day</p>,
  },
  {
    role: "Overline",
    spec: "Jakarta 700 · 12px · uppercase · +0.05em",
    phone: "12px",
    sample: <p className="text-[12px] font-bold tracking-wider text-muted uppercase">Sea report today</p>,
  },
  {
    role: "Price",
    spec: "Jakarta 700 · 14–16px · brand",
    phone: "14px",
    sample: (
      <p className="text-[16px] font-bold text-brand">
        ₹5,500 <span className="text-[11px] font-semibold text-muted">per person</span>
      </p>
    ),
  },
];

const RADII = [
  { token: "control", px: 12, use: "Inputs, island pills, small icon buttons, icon wells" },
  { token: "button", px: 16, use: "Primary buttons, search bar, option rows" },
  { token: "card", px: 18, use: "Tiles, strip cards, banners" },
  { token: "panel", px: 20, use: "Listing cards, booking panels, popovers" },
  { token: "sheet", px: 28, use: "Phone bottom sheets, desktop dialogs" },
];

const iconNames = Object.keys(Icons).filter((k) => k.endsWith("Icon")).sort();

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-line pt-12 first:border-t-0 first:pt-0">
      <h2 className="font-display text-page font-bold">{title}</h2>
      {lede && <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-muted">{lede}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[12px] font-bold tracking-wider text-muted uppercase">{children}</p>;
}

const NAV = [
  ["principles", "Principles"],
  ["color", "Colour"],
  ["type", "Type"],
  ["shape", "Radius & elevation"],
  ["layout", "Layout & breakpoints"],
  ["components", "Components"],
  ["icons", "Icons"],
  ["desktop", "Desktop patterns"],
];

export default function DesignSystemPage() {
  // Internal reference: keep it off the live site.
  if (process.env.VERCEL_ENV === "production") notFound();

  return (
    <div className="min-h-screen bg-ground text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-6 px-5 py-5 lg:px-10">
          <div className="flex items-center gap-4">
            <Image
              sizes="144px"
              src="/brand/andaman-go-light-mode.png"
              alt="Andaman Go"
              width={1600}
              height={234}
              className="h-[21px] w-auto"
            />
            <span className="rounded-full bg-brandsoft px-3 py-1 text-[11.5px] font-bold text-brand">
              Design system
            </span>
          </div>
          <p className="hidden text-[12.5px] font-medium text-muted sm:block">
            Source of truth: <code className="font-mono text-[12px]">app/globals.css</code> ·{" "}
            <code className="font-mono text-[12px]">design-system/README.md</code>
          </p>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1200px] gap-14 px-5 py-12 lg:px-10">
        <nav aria-label="Sections" className="sticky top-8 hidden h-fit w-44 shrink-0 lg:block">
          <ul className="flex flex-col gap-0.5">
            {NAV.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-control px-3 py-2 text-[13.5px] font-bold text-muted transition hover:bg-surface hover:text-brand"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-16">
          {/* ---------------------------------------------------------------- */}
          <Section
            id="principles"
            title="Principles"
            lede="The mobile app is the reference. Desktop is the same product given more room, not a different one."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["Calm, not loud", "Light cool ground, white cards, one teal. Colour is spent on the single action on a screen and on state (selected, scarce, confirmed)."],
                ["Border before shadow", "Cards are flat with a 1px line. Shadow only appears when something is raised: hovered, floating, or overlapping a hero."],
                ["Bold display, quiet body", "Bricolage Grotesque carries every heading at weight 700. Plus Jakarta Sans carries everything else. Never mix a third face."],
                ["Wider, not bigger", "On desktop, content gets more columns and more air, not bigger controls. Buttons stay 44–52px, body stays 14–15px; headings scale up."],
                ["Same words, same places", "Bookings, Help and Profile mean the same on every device: bottom tab bar on a phone, top navbar on desktop. The island switch and search follow you."],
                ["Hover is a bonus", "Every action works by tap or click alone. Hover adds a 2px lift and a brand-tinted border; it never reveals anything essential."],
              ].map(([t, d]) => (
                <div key={t} className="rounded-card border border-line bg-surface p-5">
                  <p className="text-[15px] font-bold">{t}</p>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed font-medium text-muted">{d}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section
            id="color"
            title="Colour"
            lede="Seventeen tokens, all defined once in @theme. Use the token name (bg-brand, text-muted, border-line), never a hex."
          >
            <div className="flex flex-col gap-10">
              {COLORS.map((g) => (
                <div key={g.group}>
                  <Label>{g.group}</Label>
                  <p className="-mt-1 mb-4 max-w-[62ch] text-[13.5px] font-medium text-muted">{g.note}</p>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {g.items.map((c) => (
                      <div key={c.token} className="overflow-hidden rounded-card border border-line bg-surface">
                        <div
                          className={`flex h-20 items-end p-3 ${c.outline ? "border-b border-line" : ""}`}
                          style={{ background: c.hex }}
                        >
                          <span className={`text-[12px] font-bold ${c.dark ? "text-white" : "text-ink"}`}>
                            {c.hex}
                          </span>
                        </div>
                        <div className="p-3">
                          <p className="text-[13.5px] font-bold">
                            {c.token} <span className="font-mono text-[11.5px] font-medium text-muted">--color-{c.token}</span>
                          </p>
                          <p className="mt-1 text-[12.5px] leading-snug font-medium text-muted">{c.role}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <Label>Pairings that pass</Label>
                <div className="flex flex-wrap gap-3">
                  {[
                    ["text-ink on bg-ground", "bg-ground text-ink"],
                    ["text-muted on bg-surface", "bg-surface text-muted border border-line"],
                    ["text-white on bg-brand", "bg-brand text-white"],
                    ["text-brand on bg-brandsoft", "bg-brandsoft text-brand"],
                    ["text-sandink on bg-sandsoft", "bg-sandsoft text-sandink"],
                    ["text-ink on bg-sand", "bg-sand text-ink"],
                  ].map(([l, c]) => (
                    <span key={l} className={`rounded-control px-4 py-2.5 text-[13px] font-bold ${c}`}>
                      {l}
                    </span>
                  ))}
                </div>
                <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-[12px] tracking-wider text-muted uppercase">
                        <th className="px-5 py-3 font-bold">Pair (measured, WCAG 2.x)</th>
                        <th className="px-5 py-3 font-bold">Ratio</th>
                        <th className="px-5 py-3 font-bold">Verdict</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline font-medium">
                      {[
                        ["ink on ground", "14.95", "AAA"],
                        ["white on brand", "10.85", "AAA"],
                        ["brand on brandsoft", "9.30", "AAA"],
                        ["sandink on sandsoft", "7.68", "AAA"],
                        ["ink on sand", "7.08", "AAA"],
                        ["muted on surface", "5.07", "AA"],
                        ["sandink2 on sandsoft", "5.22", "AA"],
                        ["muted on ground", "4.65", "AA"],
                        ["muted on brandsoft", "4.35", "Just under AA for small text — use ink there"],
                        ["warn on surface", "4.21", "Just under AA at 12px (\"3 left\"). Known gap"],
                        ["white on sand", "2.30", "Fails 3:1 for graphics (Plan-my-day icon). Known gap; ink on sand passes"],
                        ["navmuted on surface", "2.50", "Inactive tab labels only; never for text a traveller must read"],
                      ].map(([a, r, v]) => (
                        <tr key={a}>
                          <td className="px-5 py-2.5 text-ink">{a}</td>
                          <td className="px-5 py-2.5 font-mono text-[12px]">{r}</td>
                          <td className="px-5 py-2.5 text-muted">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section
            id="type"
            title="Type"
            lede="Two families, loaded in app/layout.tsx. Phone sizes are unchanged; desktop steps up only for headings."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-card border border-line bg-surface p-6">
                <p className="text-[12px] font-bold tracking-wider text-muted uppercase">Display · font-display</p>
                <p className="font-display mt-2 text-[44px] leading-none font-bold tracking-tight">Bricolage Grotesque</p>
                <p className="font-display mt-3 text-[19px] font-bold tracking-tight text-muted">Aa Bb Cc 0123456789 ₹</p>
              </div>
              <div className="rounded-card border border-line bg-surface p-6">
                <p className="text-[12px] font-bold tracking-wider text-muted uppercase">Body · font-body (default)</p>
                <p className="mt-2 text-[40px] leading-none font-bold tracking-tight">Plus Jakarta Sans</p>
                <p className="mt-3 text-[19px] font-semibold text-muted">Aa Bb Cc 0123456789 ₹</p>
              </div>
            </div>

            <div className="mt-6 divide-y divide-hairline overflow-hidden rounded-card border border-line bg-surface">
              {TYPE_ROLES.map((t) => (
                <div key={t.role} className="grid items-center gap-x-8 gap-y-2 px-6 py-5 md:grid-cols-[160px_minmax(0,1fr)]">
                  <div>
                    <p className="text-[13.5px] font-bold">{t.role}</p>
                    <p className="mt-0.5 text-[11.5px] font-medium text-muted">{t.spec}</p>
                    <p className="text-[11.5px] font-medium text-navmuted">Phone: {t.phone}</p>
                  </div>
                  <div className="min-w-0">{t.sample}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 max-w-[70ch] text-[12.5px] font-medium text-muted">
              The app currently uses ~20 half-pixel sizes (10.5, 11, 11.5, 12, 12.5, 13, 13.5 …). The eight roles
              above are what they collapse to. Migrate as screens are touched; don&apos;t sweep.
            </p>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section
            id="shape"
            title="Radius & elevation"
            lede="Ten corner sizes had crept in. Five named steps replace them."
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {RADII.map((r) => (
                <div key={r.token} className="rounded-card border border-line bg-surface p-4">
                  <div
                    className="h-20 border-2 border-brand bg-brandsoft"
                    style={{ borderRadius: r.px }}
                  />
                  <p className="mt-3 text-[13.5px] font-bold">
                    rounded-{r.token} <span className="text-muted">· {r.px}px</span>
                  </p>
                  <p className="mt-1 text-[12px] leading-snug font-medium text-muted">{r.use}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] font-medium text-muted">
              Plus <code className="font-mono">rounded-full</code> for chips, avatars, the desktop search pill and
              anything pill-shaped.
            </p>

            <div className="mt-10 grid gap-5 sm:grid-cols-4">
              {[
                ["Flat", "border border-line", "", "Cards at rest"],
                ["shadow-card", "border border-line shadow-card", "", "Overlaps a hero, e.g. stays search"],
                ["shadow-raised", "border border-line shadow-raised", "", "Hovered card (card-hover)"],
                ["shadow-float", "border border-line shadow-float", "", "Popover, dialog, floating panel"],
              ].map(([n, c, , u]) => (
                <div key={n} className={`rounded-card bg-surface p-5 ${c}`}>
                  <p className="text-[13.5px] font-bold">{n}</p>
                  <p className="mt-1 text-[12px] font-medium text-muted">{u}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section
            id="layout"
            title="Layout & breakpoints"
            lede="Two switches. Below 744px the app is a 430px phone column; 744–1023px (iPad portrait) keeps the phone layout in a wider column; from 1024px it is a wide well with a top navbar."
          >
            <div className="grid gap-4 md:grid-cols-3">
              {[
                ["< 744px  ·  phone", "430px column · 20px gutter · bottom tab bar · sticky Book bar · bottom sheets"],
                ["744–1023px  ·  tablet", "760px column (640px for booking flows) · 32px gutter · bottom tab bar · 2-col card grids · centred dialogs"],
                ["≥ 1024px  ·  desktop", "1200px well · 40px gutter · 68px sticky navbar · 12-col grid · sticky booking card · centred dialogs"],
              ].map(([t, d]) => (
                <div key={t} className="rounded-card border border-line bg-surface p-5">
                  <p className="text-[14px] font-bold">{t}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed font-medium text-muted">{d}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 overflow-hidden rounded-card border border-line bg-surface">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[12px] tracking-wider text-muted uppercase">
                    <th className="px-5 py-3 font-bold">Token / utility</th>
                    <th className="px-5 py-3 font-bold">Value</th>
                    <th className="px-5 py-3 font-bold">Use</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline font-medium">
                  {[
                    ["page-well", "430px → 1200px", "Browse, detail and dashboard screens: <main>, header bands, the navbar's inner row. Replaces mx-auto max-w-[430px] px-5."],
                    ["page-flow", "430px → 760px", "Booking flows (ferry, cab, plan, scooter, trip, stay checkout, confirmation): header band, form and fixed bottom bar share one centred column."],
                    ["--well", "1200px", "Max content width on desktop"],
                    ["--gutter / --gutter-desktop", "20px / 40px", "Side padding"],
                    ["--nav-h", "68px", "Desktop navbar height"],
                    ["card-hover", "lift 2px + shadow-raised", "Every clickable card; only fires on hover-capable devices ≥ lg"],
                    ["focus-ring", "2px brand outline, 2px offset", "Keyboard focus on links and buttons (desktop-critical)"],
                    ["Grid", "12 columns · 24px gap", "Hero 8 + 4 · listings 3–4 up · detail 7 + 5"],
                  ].map(([a, b, c]) => (
                    <tr key={a}>
                      <td className="px-5 py-3 font-mono text-[12px] font-bold text-brand">{a}</td>
                      <td className="px-5 py-3 text-ink">{b}</td>
                      <td className="px-5 py-3 text-muted">{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section
            id="components"
            title="Components"
            lede="Extracted from the shipping screens, drawn here at desktop size with the same class strings the app uses. Phone sizes differ only where noted in the type table."
          >
            <div className="flex flex-col gap-10">
              <div>
                <Label>Buttons</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="focus-ring flex h-13 items-center justify-center gap-2 rounded-button bg-brand px-8 text-[15px] font-bold text-white transition hover:bg-brand/90">
                    Book now <ChevronIcon size={18} />
                  </button>
                  <button type="button" className="focus-ring flex h-13 items-center justify-center rounded-button border border-line bg-surface px-6 text-[14px] font-bold text-muted transition hover:border-brand/40 hover:text-brand">
                    Back
                  </button>
                  <button type="button" className="focus-ring flex h-13 items-center justify-center rounded-button bg-brand px-8 text-[15px] font-bold text-white opacity-40">
                    Disabled
                  </button>
                  <button type="button" className="focus-ring rounded-button bg-brand px-6 py-3 text-[14px] font-bold text-white">
                    Book
                  </button>
                  <button type="button" className="focus-ring h-11 rounded-full bg-sand px-6 text-[14.5px] font-semibold text-ink">
                    Create an account
                  </button>
                </div>
                <p className="mt-3 max-w-[70ch] text-[12.5px] font-medium text-muted">
                  Primary (h-13, rounded-button, brand) · Secondary (line border) · Disabled (opacity-40) · Compact
                  (sticky bar) · Sand pill is marketing-only and is the one place ink text sits on a filled button.
                  One primary per screen region.
                </p>
              </div>

              <div>
                <Label>Chips, filters & badges</Label>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="flex h-9 items-center rounded-full border border-brand bg-brand px-3.5 text-[12.5px] font-semibold text-white">All</span>
                  <span className="flex h-9 items-center rounded-full border border-line bg-surface px-3.5 text-[12.5px] font-semibold text-muted">Scuba</span>
                  <span className="flex h-9 items-center rounded-full border border-line bg-surface px-3.5 text-[12.5px] font-semibold text-muted">Sea walk</span>
                  <span className="mx-2 h-6 w-px bg-line" />
                  <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand shadow-sm ring-1 ring-line">Scuba</span>
                  <span className="flex items-center gap-1.5 rounded-full bg-brandsoft px-2.5 py-1.5 text-[11.5px] font-semibold text-brand"><CheckIcon size={13} /> Confirmed</span>
                  <span className="flex items-center gap-1.5 rounded-full bg-sandsoft px-2.5 py-1.5 text-[11.5px] font-semibold text-sandink2"><ClockIcon size={13} /> Awaiting confirmation</span>
                  <span className="text-[12px] font-semibold text-warn">3 left</span>
                </div>
              </div>

              <div>
                <Label>Inputs</Label>
                <div className="grid max-w-[720px] gap-4 sm:grid-cols-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-bold text-muted">Check-in</span>
                    <input readOnly value="24 Sep 2026" className="focus-ring h-12 w-full rounded-control border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand" />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-bold text-muted">Island</span>
                    <select className="h-12 w-full rounded-control border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand">
                      <option>Swaraj Dweep</option>
                    </select>
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-bold text-muted">Guests</span>
                    <div className="flex h-12 items-center justify-between rounded-control border border-line bg-surface px-3.5">
                      <span className="text-[14px] font-semibold">2 guests</span>
                      <span className="flex gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[16px] font-bold text-brand">−</span>
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-[16px] font-bold text-white">+</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <Label>Cards</Label>
                <div className="grid gap-5 lg:grid-cols-3">
                  <div className="card-hover flex h-[148px] flex-col justify-between rounded-card border border-line bg-surface p-5">
                    <span className="flex h-11 w-11 items-center justify-center rounded-control bg-brandsoft text-brand"><PinIcon size={24} /></span>
                    <div>
                      <p className="text-[16.5px] font-bold">Category tile</p>
                      <p className="mt-1 text-[13px] font-medium text-muted">Icon well, title, one line</p>
                    </div>
                  </div>

                  <div className="card-hover overflow-hidden rounded-panel border border-line bg-surface">
                    <div className="relative h-32 bg-brandsoft">
                      <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand">Scuba</span>
                      <span className="absolute right-3 bottom-3 rounded-full bg-white/95 px-3 py-1.5 text-[14px] font-bold text-brand shadow-sm">₹5,500<span className="text-[10.5px] font-semibold text-muted"> / person</span></span>
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[16px] leading-tight font-bold">Listing card</p>
                        <span className="flex items-center gap-1.5"><StarIcon size={14} className="text-sand" /><span className="text-[12.5px] font-bold">4.8</span><span className="text-[12px] font-medium text-muted">(32)</span></span>
                      </div>
                      <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-brand"><ShieldIcon size={14} />Scuba Andaman</p>
                      <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3 text-[12px] font-semibold">
                        <span className="flex items-center gap-1.5 text-muted"><ClockIcon size={14} />Next · Tomorrow 9:00 am</span>
                        <span className="text-warn">3 left</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 rounded-card bg-brandsoft px-4 py-3.5 text-brand">
                      <Icons.SunSeaIcon size={24} className="shrink-0" />
                      <div>
                        <p className="text-[11px] font-bold tracking-wider uppercase opacity-70">Sea report today</p>
                        <p className="mt-0.5 text-[13.5px] leading-snug font-semibold">Sea calm · easy crossings</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 rounded-card border border-sandline bg-sandsoft p-5">
                      <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-sand text-white"><PlanIcon size={24} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold text-sandink">Plan my day</p>
                        <p className="mt-0.5 text-[12.5px] leading-snug font-medium text-sandink2">Sand banner: plans, cautions, weather.</p>
                      </div>
                      <ChevronIcon size={20} className="text-sandicon" />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <Label>Option rows (radio / choice)</Label>
                <div className="grid max-w-[720px] gap-2.5 sm:grid-cols-2">
                  <div className="flex items-center gap-3 rounded-button border border-brand bg-brandsoft px-4 py-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-brand bg-brand text-white"><CheckIcon size={13} /></span>
                    <span><span className="block text-[13.5px] font-bold">Pay in full</span><span className="block text-[11.5px] font-medium text-muted">Nothing due on arrival</span></span>
                  </div>
                  <div className="flex items-center gap-3 rounded-button border border-line bg-surface px-4 py-3">
                    <span className="h-5 w-5 rounded-full border border-line" />
                    <span><span className="block text-[13.5px] font-bold">Pay a deposit now</span><span className="block text-[11.5px] font-medium text-muted">Balance at the counter</span></span>
                  </div>
                </div>
              </div>

              <div>
                <Label>Navbar (desktop) — live component</Label>
                <div className="overflow-hidden rounded-card border border-line bg-surface">
                  <div className="flex h-[68px] items-center gap-6 px-6">
                    <Image sizes="144px" src="/brand/andaman-go-light-mode.png" alt="" width={1600} height={234} className="h-[21px] w-auto" />
                    <span className="flex h-11 max-w-[320px] flex-1 items-center gap-2.5 rounded-full border border-line bg-ground px-4 text-[13.5px] font-medium text-muted"><Icons.SearchIcon size={17} />Search activities, tables, trips</span>
                    <span className="ml-auto rounded-full bg-brandsoft px-4 py-2 text-[13.5px] font-bold text-brand">Explore</span>
                    <span className="px-2 text-[13.5px] font-bold text-muted">Bookings</span>
                    <span className="px-2 text-[13.5px] font-bold text-muted">Help</span>
                    <span className="flex h-10 items-center gap-2 rounded-full border border-line px-3.5 text-[13px] font-semibold"><PinIcon size={15} className="text-brand" />Swaraj Dweep</span>
                    <span className="flex h-10 w-10 items-center justify-center rounded-control border border-line text-brand"><Icons.UserIcon size={19} /></span>
                  </div>
                </div>
                <p className="mt-3 text-[12.5px] font-medium text-muted">
                  Implemented in <code className="font-mono">app/desktop-nav.tsx</code>; open any traveller screen at
                  1024px or wider to see the real one.
                </p>
              </div>
            </div>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section id="icons" title="Icons" lede="One hand-drawn set in app/icons.tsx: 24px grid, 1.6 stroke, round caps, currentColor. Tint with text-* utilities; never fill.">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
              {iconNames.map((name) => {
                const Icon = (Icons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[name];
                return (
                  <div key={name} className="flex flex-col items-center gap-2.5 rounded-control border border-line bg-surface px-2 py-4 text-brand">
                    <Icon size={24} />
                    <span className="text-[10.5px] font-semibold text-muted">{name.replace(/Icon$/, "")}</span>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section
            id="desktop"
            title="Desktop patterns"
            lede="How the same components are arranged from 1024px. Every traveller screen now follows one of these four shapes."
          >
            <div className="grid gap-8 lg:grid-cols-2">
              <Wire title="Home (shipped)" caption="8 + 4 hero, 4-up tiles, 3–4-up strips">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-8 h-14 rounded-lg bg-brandsoft" />
                  <div className="col-span-4 h-14 rounded-lg bg-sandsoft" />
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="col-span-3 h-10 rounded-lg border border-line bg-surface" />
                  ))}
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="col-span-3 h-16 rounded-lg border border-line bg-surface" />
                  ))}
                </div>
              </Wire>

              <Wire title="Browse lists (shipped)" caption="Activities, events, stays, trips, rentals, community, search: wrapping filter chips, then a 3-up card grid (2-up for community)">
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-5 w-12 rounded-full border border-line bg-surface" />
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-20 rounded-lg border border-line bg-surface" />
                    ))}
                  </div>
                </div>
              </Wire>

              <Wire title="Detail page (shipped)" caption="Activity, event, stay, community, trip: 7 + 5, gallery and story left, sticky booking card right; the phone Book bar is hidden. Rentals put a sticky price summary and Pay button on the right.">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-7 flex flex-col gap-2">
                    <div className="h-28 rounded-lg bg-brandsoft" />
                    <div className="h-4 w-2/3 rounded bg-line" />
                    <div className="h-3 w-full rounded bg-hairline" />
                    <div className="h-3 w-5/6 rounded bg-hairline" />
                  </div>
                  <div className="col-span-5 h-40 rounded-lg border border-line bg-surface shadow-raised" />
                </div>
              </Wire>

              <Wire title="Bookings, profile, help (shipped)" caption="Two columns: bookings by day, profile settings, help contacts beside the FAQ; sheets become centred dialogs">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-7 flex flex-col gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-12 rounded-lg border border-line bg-surface" />
                    ))}
                  </div>
                  <div className="col-span-5 flex flex-col gap-2">
                    <div className="h-24 rounded-lg bg-brand" />
                    <div className="h-14 rounded-lg border border-line bg-surface" />
                  </div>
                </div>
              </Wire>

              <Wire title="Booking flow (shipped)" caption="Ferry, cab, plan, stay search, confirmation: one centred 760px column, bottom summary bar aligned to it">
                <div className="mx-auto flex max-w-[55%] flex-col gap-2">
                  <div className="h-8 rounded-lg bg-brand" />
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-lg border border-line bg-surface" />
                  ))}
                  <div className="h-7 rounded-lg border border-line bg-surface shadow-raised" />
                </div>
              </Wire>
            </div>
          </Section>
        </main>
      </div>
    </div>
  );
}

function Wire({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <figure>
      <div className="rounded-panel border border-line bg-ground p-4">
        <div className="mb-3 flex h-6 items-center gap-1.5 rounded-md bg-surface px-2">
          <span className="h-2 w-8 rounded bg-line" />
          <span className="h-2 flex-1 rounded-full bg-hairline" />
          <span className="h-2 w-6 rounded bg-brandsoft" />
        </div>
        {children}
      </div>
      <figcaption className="mt-3">
        <p className="text-[14px] font-bold">{title}</p>
        <p className="mt-0.5 text-[12.5px] font-medium text-muted">{caption}</p>
      </figcaption>
    </figure>
  );
}
