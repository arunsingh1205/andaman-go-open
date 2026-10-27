# Andaman Go — open source travel marketplace

The code behind [andamango.in](https://www.andamango.in): one place to book ferries,
stays, activities, scooters, cabs, trips and events across the Andaman Islands.

One Next.js codebase runs three apps:

| App | Path | Who it's for |
|---|---|---|
| Traveller app | `/explore`, `/activities`, `/ferry`, `/stays`, `/cabs`, … | Visitors browsing and booking |
| Partner app | `/partner/*` | Operators: listings, schedules, bookings, QR check-in, earnings, settlements |
| Admin console | `/admin/*` | The platform team: review, bookings, revenue, payouts, support |

Plus Capacitor wrappers for Android and iOS (`android/`, `android-app/`, `ios/`, `ios-app/`).

## Stack

- **Next.js 16** (App Router) · React 19 · Tailwind CSS 4
- **Supabase** — Postgres with row-level security on every table, auth, storage, edge functions
- **Razorpay** payments · **Resend** email · **Twilio** WhatsApp + Verify OTP
- **Capacitor 8** native shells · Codemagic for iOS builds · Vercel hosting + cron

## Run it locally

1. `npm install --include=dev`
2. Create a Supabase project and run the SQL in `supabase/` in numeric order
   (`schema.sql`, `seed.sql`, then `002-…` upward). `supabase/functions/` holds the edge functions.
3. Copy `.env.example` to `.env.local` and fill in your own keys. Only the two
   `NEXT_PUBLIC_SUPABASE_*` values are needed to browse; payments, email, SMS and
   WhatsApp each need their own provider keys.
4. `npm run dev` and open http://localhost:3000

Set `SITE_MODE=coming-soon` to put the traveller routes behind a coming-soon page;
`?preview=<PREVIEW_KEY>` unlocks it for 30 days.

## Not included

To keep this repo free of private and brand material, it ships **without**:

- API keys, passwords, signing keys or any `.env` file — bring your own
- Production data (no real operator or customer records)
- The Andaman Go logo, brand images, marketing photos and partner brochure.
  Pages that reference `/brand/*` or `/marketing/*` will show missing images
  until you add your own files to `public/brand/` and `public/marketing/`.

If you fork this for your own project, also replace the contact details in
`app/(legal)/legal-meta.ts`, `app/help/page.tsx` and the email templates, and the
app IDs in `capacitor.config.ts` and the native projects.

The "Andaman Go" name and logo are not covered by the code license.

## License

[MIT](LICENSE) — free to use, modify and share.
