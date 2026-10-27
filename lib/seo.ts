// What search engines and link scrapers read, in one place: the site's own
// address, the metadata every listing page shares, and the small pieces of
// schema.org structured data the detail pages repeat.

import type { Metadata } from "next";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://andamango.in").replace(/\/$/, "");
export const SITE_NAME = "Andaman Go";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

/** A partner's "about" can run to paragraphs; a search result shows ~160
 *  characters. Cut on a word so the snippet doesn't end mid-syllable. */
export function clip(text: string | null | undefined, max = 160): string | undefined {
  const flat = text?.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).trimEnd()}…`;
}

/** Title, snippet, canonical and share card for one listing's page.
 *
 *  `images` is left off entirely when the listing has no photo — an absent
 *  key is what lets Next fall back to app/opengraph-image.png; a key set to
 *  undefined or [] would count as "this page has no image". */
export function listingMetadata({
  title,
  description,
  path,
  image,
}: {
  title: string;
  description: string | null | undefined;
  path: string;
  image?: string;
}): Metadata {
  // Spread in rather than set to undefined, for the same reason as `images`:
  // a listing with no blurb then inherits the site's own description.
  const desc = clip(description);
  const text = desc ? { description: desc } : {};
  const images = image ? { images: [image] } : {};

  return {
    title,
    ...text,
    alternates: { canonical: path },
    openGraph: {
      title,
      ...text,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_IN",
      ...images,
    },
    twitter: { card: "summary_large_image", title, ...text, ...images },
  };
}

/** Stars only once someone has actually reviewed — Google treats a rating
 *  with no reviews behind it as invalid markup. */
export function aggregateRating(rating: string, reviews: number) {
  const value = Number(rating);
  if (reviews <= 0 || !Number.isFinite(value) || value <= 0) return undefined;
  return { "@type": "AggregateRating", ratingValue: value, reviewCount: reviews, bestRating: 5 };
}

/** Every listing is somewhere in the same union territory; `locality` is the
 *  listing's own area or island. */
export function andamanAddress(locality: string | null | undefined) {
  return {
    "@type": "PostalAddress",
    addressLocality: locality || undefined,
    addressRegion: "Andaman and Nicobar Islands",
    addressCountry: "IN",
  };
}

/** An INR price a listing can be booked at, at its own page. */
export function offer(pricePaise: number, path: string, inStock = true) {
  return {
    "@type": "Offer",
    price: (pricePaise / 100).toFixed(2),
    priceCurrency: "INR",
    availability: inStock ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
    url: absoluteUrl(path),
  };
}
