// Plan my day — the "does this day actually fit together" engine.
//
// Plain functions, no "use server", no database. The server action in
// app/plan/actions.ts is the authority — it re-derives every duration from the
// real catalogue and runs this — but the client imports the same file to give
// instant feedback as the basket changes. One set of rules, two callers.
//
// The traveller builds their own day now; we don't lay it out for them. What we
// owe them is a warning when two things can't both be true: scuba runs about
// three hours, so a 9 AM dive and a 10 AM anything is not a day that happens.
// Rides (a scooty for the day) run alongside everything and never clash.

export type PlanKind = "ride" | "activity" | "event" | "ferry";

/**
 * Minutes a stop occupies once you're there, by kind. Activities key off their
 * own category (`subKind`); a ferry carries its real crossing time instead.
 * These are deliberately generous — the cost of a false "too tight" warning is
 * lower than the cost of selling someone an impossible morning.
 */
export const DURATION_MINS: Record<string, number> = {
  // activity categories (lib/activities.ts → Activity["category"])
  scuba: 180,
  seawalk: 120,
  snorkel: 150,
  water: 75,
  stargazing: 120,
  // other timed kinds
  event: 120,
};

/** A stop's own duration, before any buffer. */
export function durationOf(line: PlanLine): number {
  if (line.kind === "ferry") return line.durationMins ?? 90;
  if (line.kind === "activity") return DURATION_MINS[line.subKind ?? ""] ?? 120;
  return DURATION_MINS[line.kind] ?? 90;
}

/** Getting yourself from one booked thing to the next. */
export const TRANSFER_MINS = 30;
/** Dead time between a ferry landing and doing anything on the far island. */
export const FERRY_LANDING_MINS = 90;
/** A dive/snorkel/sea-walk specifically needs longer after a crossing —
 *  operators want you rested and the boat leaves from a third place. */
export const WATER_AFTER_FERRY_MINS = 150;

const WATER_SUBKINDS = new Set(["scuba", "seawalk", "snorkel", "water"]);

export type PlanLine = {
  key: string;
  kind: PlanKind;
  /** Activity category, for the duration lookup. */
  subKind?: string;
  title: string;
  timeLabel: string;
  /** Minutes past midnight IST. Undefined for an all-day ride. */
  startMins?: number;
  /** Only a ferry passes its own; everything else is looked up. */
  durationMins?: number;
  party: number;
};

export type PlanIssue = {
  level: "block" | "warn";
  code:
    | "overlap"
    | "ferry-water"
    | "before-ferry"
    | "packed"
    | "long-gap"
    | "tight"
    | "unavailable";
  message: string;
  /** Which lines the issue points at, so the UI can mark them. */
  keys: string[];
};

/** startMins + its own duration. NaN-safe: an all-day line has no end. */
export function endMins(line: PlanLine): number {
  return line.startMins === undefined ? NaN : line.startMins + durationOf(line);
}

const clock = (mins: number) => {
  const t = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(t / 60);
  const m = t % 60;
  const s = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${s}`;
};

/**
 * Every problem with a proposed day, worst first. `block` issues must clear
 * before the day can be booked; `warn` issues need the traveller's OK.
 */
export function checkPlan(lines: PlanLine[]): PlanIssue[] {
  const issues: PlanIssue[] = [];

  const timed = lines
    .filter((l) => l.startMins !== undefined)
    .sort((a, b) => a.startMins! - b.startMins!);

  const ferry = timed.find((l) => l.kind === "ferry");

  // --- hard blocks -------------------------------------------------------

  // Overlapping stops. Compare each pair once; a gap of at least TRANSFER_MINS
  // between the end of the earlier and the start of the later is the minimum.
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      const gap = b.startMins! - endMins(a);
      if (gap < 0) {
        issues.push({
          level: "block",
          code: "overlap",
          message: `${a.title} starts at ${a.timeLabel} and runs until about ${clock(
            endMins(a),
          )} — it clashes with ${b.title} at ${b.timeLabel}.`,
          keys: [a.key, b.key],
        });
      } else if (gap < TRANSFER_MINS) {
        issues.push({
          level: "warn",
          code: "tight",
          message: `Only ${Math.round(gap)} min between ${a.title} finishing (~${clock(
            endMins(a),
          )}) and ${b.title} at ${b.timeLabel}. Cutting it fine.`,
          keys: [a.key, b.key],
        });
      }
    }
  }

  // Ferry rules — dormant until a ferry can be added to the basket, but the
  // engine is the same either way.
  if (ferry && ferry.startMins !== undefined) {
    const departs = ferry.startMins;
    const lands = endMins(ferry);

    for (const l of timed) {
      if (l.key === ferry.key) continue;

      // Anything that ends after the boat leaves is left behind.
      if (l.startMins! < departs && endMins(l) > departs) {
        issues.push({
          level: "block",
          code: "before-ferry",
          message: `${l.title} won't be finished before the ${ferry.timeLabel} ferry leaves.`,
          keys: [l.key, ferry.key],
        });
      }

      // Water activities need a long gap after landing.
      if (l.startMins! >= departs && WATER_SUBKINDS.has(l.subKind ?? "")) {
        const readyAt = lands + WATER_AFTER_FERRY_MINS;
        if (l.startMins! < readyAt) {
          issues.push({
            level: "block",
            code: "ferry-water",
            message: `The ferry lands around ${clock(
              lands,
            )}. ${l.title} at ${l.timeLabel} is too soon after a crossing — earliest is about ${clock(
              readyAt,
            )}.`,
            keys: [l.key, ferry.key],
          });
        }
      } else if (l.startMins! >= departs && l.startMins! < lands + FERRY_LANDING_MINS) {
        issues.push({
          level: "block",
          code: "ferry-water",
          message: `The ferry lands around ${clock(lands)}. Nothing else can start before about ${clock(
            lands + FERRY_LANDING_MINS,
          )}.`,
          keys: [l.key, ferry.key],
        });
      }
    }
  }

  // --- soft warnings ---------------------------------------------------

  const activityLines = timed.filter((l) => l.kind === "activity");
  const waterLines = activityLines.filter((l) => WATER_SUBKINDS.has(l.subKind ?? ""));
  const busyMins = timed.reduce(
    (sum, l) => sum + durationOf(l) + TRANSFER_MINS,
    0,
  );

  const packedReasons: string[] = [];
  if (timed.length >= 4) packedReasons.push(`${timed.length} timed bookings`);
  if (activityLines.length >= 3)
    packedReasons.push(`${activityLines.length} activities`);
  if (waterLines.length >= 3 && waterLines.length !== activityLines.length)
    packedReasons.push(`${waterLines.length} of them in the water`);
  if (busyMins > 9 * 60)
    packedReasons.push(`around ${Math.round(busyMins / 60)} hours of it once you add travel time`);

  if (packedReasons.length > 0) {
    issues.push({
      level: "warn",
      code: "packed",
      message: `That's a lot for one day — ${packedReasons.join(", ")}. Sure you want all of it?`,
      keys: timed.map((l) => l.key),
    });
  }

  // A big empty stretch mid-day — usually a mistake, sometimes deliberate.
  for (let i = 1; i < timed.length; i++) {
    const gap = timed[i].startMins! - endMins(timed[i - 1]);
    if (gap > 4 * 60) {
      issues.push({
        level: "warn",
        code: "long-gap",
        message: `${Math.round(gap / 60)} hours free between ${timed[i - 1].title} and ${timed[i].title} — plenty of time, or a gap to fill.`,
        keys: [timed[i - 1].key, timed[i].key],
      });
    }
  }

  // Blocks first, then warnings, stable within each.
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "block" ? -1 : 1));
}

/**
 * "8:00 AM" / "8 PM" / "13:30" → minutes past midnight. Used to place a slot's
 * timeLabel on the day when the raw minute figure isn't to hand.
 */
export function parseClock(label: string): number {
  const m = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return 0;
  let h = Number(m[1]) % 24;
  const min = Number(m[2] ?? 0);
  const mer = m[3]?.toUpperCase();
  if (mer === "PM" && h < 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/** Minutes past midnight IST for an ISO instant — the server's check of a
 *  slot's start, independent of whatever the client claimed. */
export function istMinutes(iso: string): number {
  const hhmm = new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
