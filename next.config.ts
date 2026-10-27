import type { NextConfig } from "next";

// Screens that should never turn up in a search result: the partner, admin
// and ops consoles, a traveller's own bookings and profile, search-result
// pages that are a different page for every query string, and the internal
// previews. Sent as a header rather than set per page so one list covers
// every route under each prefix, including ones added later.
const NOINDEX = [
  "/admin/:path*",
  "/partner/:path*",
  "/ops/:path*",
  "/bookings/:path*",
  "/booked/:path*",
  "/profile/:path*",
  "/search",
  "/plan",
  "/stays/results",
  "/soon",
  "/pay-test",
  "/design-system",
  "/cab-design-preview",
];

const nextConfig: NextConfig = {
  async headers() {
    return NOINDEX.map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }],
    }));
  },
  // Lets the dev server accept requests from a phone on the same Wi-Fi
  // (and from a tunnel, if one is used) instead of localhost only.
  // The router reassigns this PC's address, so the whole subnet is allowed.
  allowedDevOrigins: [
    "192.168.1.*",
    "192.168.0.*",
    "*.trycloudflare.com",
    "*.loca.lt",
    "*.ngrok-free.app",
  ],
  // Every partner/listing photo lives in Supabase Storage's public bucket
  // (lib/partner-storage.ts's partnerPhotoUrl()) — this is what lets
  // next/image optimize/resize/lazy-load them instead of the app serving
  // raw <img> everywhere because no host was ever allow-listed.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
