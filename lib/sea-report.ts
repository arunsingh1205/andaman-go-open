// The "Sea report today" line under the island picker — and the water-timing
// note on the plan screen — used to be a sentence someone typed into
// lib/islands.ts. This reads a live marine forecast keyed to each island's own
// stretch of water instead.
//
// Source: Open-Meteo's Marine API — free, no key, one request covers all three
// islands. Server-only (Next caches the response for 30 minutes). If it's slow
// or down we fall back to the static line in lib/islands.ts, so the picker
// never waits on the network to render.

import { cache } from "react";
import { ISLANDS, type IslandId } from "./islands";

export type SeaReport = {
  /** Calm enough that the picker keeps its blue treatment, not the sand one. */
  calm: boolean;
  /** One line, sentence case, no trailing punctuation —
   *  e.g. "Calm this morning · choppier after 2 PM". */
  line: string;
};

// A point of open water off each island — Open-Meteo snaps to its nearest
// marine grid cell, so this only needs to be roughly right.
const COORDS: Record<IslandId, { lat: number; lon: number }> = {
  pb: { lat: 11.65, lon: 92.78 },
  hv: { lat: 12.0, lon: 93.02 },
  nl: { lat: 11.83, lon: 93.05 },
};

// Wave height in metres. Andaman inshore waters sit well under half a metre on
// a settled day and climb past a metre once the afternoon wind fills in.
const CALM_M = 0.7;
const ROUGH_M = 1.2;
// Afternoon-minus-morning rise that counts as "building".
const RISE_M = 0.2;

const ORDER = Object.keys(COORDS) as IslandId[];

const ENDPOINT =
  "https://marine-api.open-meteo.com/v1/marine" +
  `?latitude=${ORDER.map((id) => COORDS[id].lat).join(",")}` +
  `&longitude=${ORDER.map((id) => COORDS[id].lon).join(",")}` +
  "&hourly=wave_height&timezone=Asia%2FKolkata&forecast_days=1";

type Hourly = { time: string[]; wave_height: (number | null)[] };
type Point = { hourly?: Hourly };

/** Sea report per island, cover the picker's blue/sand split. Falls back to the
 *  static lines in lib/islands.ts whenever the forecast can't be reached. */
export const getSeaReports = cache(
  async (): Promise<Record<IslandId, SeaReport>> => {
    const reports = fallbackReports();
    try {
      const res = await fetch(ENDPOINT, { next: { revalidate: 1800 } });
      if (!res.ok) return reports;

      const body = (await res.json()) as Point | Point[];
      const points = Array.isArray(body) ? body : [body];

      ORDER.forEach((id, i) => {
        const described = describe(points[i]?.hourly);
        if (described) reports[id] = described;
      });
      return reports;
    } catch {
      return reports;
    }
  },
);

function fallbackReports(): Record<IslandId, SeaReport> {
  return Object.fromEntries(
    ISLANDS.map((i) => [i.id, { calm: i.calm, line: i.line }]),
  ) as Record<IslandId, SeaReport>;
}

function describe(hourly: Hourly | undefined): SeaReport | null {
  if (!hourly?.time?.length) return null;

  const between = (from: number, to: number) => {
    const out: number[] = [];
    hourly.time.forEach((t, i) => {
      const hour = Number(t.slice(11, 13));
      const wave = hourly.wave_height[i];
      if (hour >= from && hour < to && typeof wave === "number") out.push(wave);
    });
    return out;
  };

  const daytime = between(6, 19);
  if (daytime.length === 0) return null;

  const peak = Math.max(...daytime);
  const rising = mean(between(13, 19)) - mean(between(6, 12)) >= RISE_M;
  const swell = `${peak.toFixed(1)} m`;

  if (peak >= ROUGH_M) {
    return {
      calm: false,
      line: rising
        ? `Building to ${swell} swell by afternoon — water best before noon`
        : `Rough today · around ${swell} swell`,
    };
  }
  if (peak >= CALM_M) {
    return {
      calm: false,
      line: rising
        ? "Calm this morning · choppier after 2 PM"
        : "A little choppy · crossings still fine",
    };
  }
  return {
    calm: true,
    line: rising
      ? "Sea calm now · breezy from late afternoon"
      : "Sea calm · easy crossings all day",
  };
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
