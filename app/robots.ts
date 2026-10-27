import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Only /api is blocked from crawling. The signed-in and internal screens
// (/admin, /partner, /bookings…) are kept out of search by the noindex header
// in next.config.ts instead — a crawler has to be able to fetch a page to see
// that header, so blocking them here as well would undo it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
