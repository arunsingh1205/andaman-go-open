"use server";

// One call: log a page view. Fire-and-forget from <VisitBeacon>. The browser
// sends only what it alone knows (path, referrer, utm_*, ids); everything
// about *where* the visitor is comes from the platform's request headers
// here, so it can't be spoofed by the page. The DB function (155) does the
// length-capping.

import { headers } from "next/headers";
import { supabaseServer } from "./supabase-server";

export type VisitInput = {
  visitorId: string;
  sessionId: string;
  path: string;
  isLanding: boolean;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  isApp: boolean;
};

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|headless|lighthouse|pingdom|uptime|curl|wget|python|axios|node-fetch/i;

// Friendly names for the referrers people actually arrive from.
const SOURCES: [RegExp, string][] = [
  [/(^|\.)google\./, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)yahoo\./, "Yahoo"],
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, "Instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|lm\.facebook\.com|l\.facebook\.com)$/, "Facebook"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "WhatsApp"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "X / Twitter"],
  [/(^|\.)(t\.me|telegram\.org)$/, "Telegram"],
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)tripadvisor\./, "Tripadvisor"],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
];

function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function classify(ua: string): { device: string; browser: string; os: string } {
  const device = /ipad|tablet/i.test(ua) ? "Tablet" : /mobi|android|iphone/i.test(ua) ? "Mobile" : "Desktop";
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /samsungbrowser/i.test(ua)
      ? "Samsung Internet"
      : /(chrome|crios)\//i.test(ua)
        ? "Chrome"
        : /(firefox|fxios)\//i.test(ua)
          ? "Firefox"
          : /safari\//i.test(ua)
            ? "Safari"
            : "Other";
  const os = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad|ipod/i.test(ua)
      ? "iOS"
      : /windows/i.test(ua)
        ? "Windows"
        : /mac os/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : "Other";
  return { device, browser, os };
}

export async function recordSiteVisit(v: VisitInput): Promise<void> {
  try {
    const h = await headers();
    const ua = h.get("user-agent") ?? "";
    if (!ua || BOT.test(ua)) return;

    let referrerHost = "";
    try {
      if (v.referrer) referrerHost = new URL(v.referrer).hostname.replace(/^www\./, "");
    } catch {
      // not a URL — treat as no referrer
    }
    // Our own domain is not a "source" — that's just navigation.
    const own = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://andamango.in").hostname.replace(/^www\./, "");
    if (referrerHost === own) referrerHost = "";

    const utmSource = v.utmSource.trim().toLowerCase();
    let source: string | null = null;
    if (utmSource) {
      const known = SOURCES.find(([re]) => re.test(utmSource + ".com") || re.test(utmSource));
      source = known ? known[1] : titleCase(utmSource);
    } else if (referrerHost) {
      source = SOURCES.find(([re]) => re.test(referrerHost))?.[1] ?? referrerHost;
    }

    const decode = (s: string | null) => {
      if (!s) return null;
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };

    const { device, browser, os } = classify(ua);
    const supabase = await supabaseServer();
    await supabase.rpc("record_site_visit", {
      p_visitor_id: v.visitorId,
      p_session_id: v.sessionId,
      p_path: v.path,
      p_is_landing: v.isLanding,
      p_source: source,
      p_medium: v.utmMedium.trim().toLowerCase() || null,
      p_campaign: v.utmCampaign.trim() || null,
      p_referrer: referrerHost || null,
      p_country: h.get("x-vercel-ip-country"),
      p_region: decode(h.get("x-vercel-ip-country-region")),
      p_city: decode(h.get("x-vercel-ip-city")),
      p_device: device,
      p_browser: browser,
      p_os: os,
      p_is_app: v.isApp,
    });
  } catch {
    // A missed visit count is nobody's problem.
  }
}
