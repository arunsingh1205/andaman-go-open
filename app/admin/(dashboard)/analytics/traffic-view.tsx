"use client";

import Link from "next/link";
import type { Traffic, Counted } from "@/lib/admin-traffic";
import { PageHeader, Panel, StatTile, EmptyState } from "../admin-ui";

const RANGES = [7, 30, 90];

const countryName = (() => {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => {
      try {
        return code === "??" ? "Unknown" : (dn.of(code) ?? code);
      } catch {
        return code;
      }
    };
  } catch {
    return (code: string) => code;
  }
})();

/** A ranked list with a proportional bar behind each name. */
function Bars({
  rows,
  empty = "Nothing yet.",
  unit = "visitors",
}: {
  rows: { label: string; sub?: string; n: number }[];
  empty?: string;
  unit?: string;
}) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="divide-y divide-hairline">
      {rows.map((r) => (
        <li key={r.label + (r.sub ?? "")} className="relative px-5 py-2.5">
          <div
            className="absolute inset-y-1 left-0 rounded-r-lg bg-brandsoft"
            style={{ width: `${Math.max((r.n / max) * 100, 2)}%` }}
            aria-hidden
          />
          <div className="relative flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-semibold">
              {r.label}
              {r.sub && <span className="ml-1.5 font-medium text-muted">{r.sub}</span>}
            </span>
            <span className="shrink-0 font-bold tabular-nums">
              {r.n.toLocaleString("en-IN")}
              <span className="ml-1 text-[11px] font-medium text-muted">{unit}</span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const asRows = (list: Counted[], label = (n: string) => n) =>
  list.map((c) => ({ label: label(c.name), n: c.visitors }));

export default function TrafficView({ data }: { data: Traffic & { failed?: boolean } }) {
  const { totals, daily } = data;
  const maxDay = Math.max(...daily.map((d) => d.visitors), 1);
  const returning = Math.max(totals.visitors - totals.newVisitors, 0);

  return (
    <>
      <PageHeader title="Traffic" subtitle={`Last ${data.days} days · who is visiting and where from`}>
        {RANGES.map((d) => (
          <Link
            key={d}
            href={`/admin/analytics?days=${d}`}
            className={`flex h-9 items-center rounded-xl border px-3 text-[12.5px] font-bold ${
              d === data.days ? "border-brand bg-brandsoft text-brand" : "border-line bg-surface text-ink"
            }`}
          >
            {d}d
          </Link>
        ))}
      </PageHeader>

      {data.failed && (
        <p className="mb-4 rounded-card border border-sandline bg-sandsoft p-3 text-[13px] font-medium text-sandink">
          Couldn&apos;t load traffic. If this is the first time, run supabase/155-site-visits-analytics.sql
          in the SQL editor.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Visitors" value={totals.visitors.toLocaleString("en-IN")} hint="unique browsers / devices" tone="brand" />
        <StatTile label="Visits" value={totals.sessions.toLocaleString("en-IN")} hint="sessions" />
        <StatTile label="Page views" value={totals.pageviews.toLocaleString("en-IN")} />
        <StatTile label="New vs returning" value={`${totals.newVisitors} / ${returning}`} hint="first time seen / seen before" />
      </div>

      <Panel title="Visitors per day" className="mt-5">
        {daily.length === 0 ? (
          <EmptyState>No visits recorded yet.</EmptyState>
        ) : (
          <div className="flex h-36 items-end gap-[3px] px-5 pt-5 pb-3">
            {daily.map((d) => (
              <div
                key={d.day}
                className="min-w-0 flex-1 rounded-t bg-brand/80"
                style={{ height: `${Math.max((d.visitors / maxDay) * 100, d.visitors ? 3 : 0.5)}%` }}
                title={`${d.day}: ${d.visitors} visitors, ${d.pageviews} page views`}
              />
            ))}
          </div>
        )}
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Where they came from">
          <Bars rows={asRows(data.sources)} empty="No visits yet." />
        </Panel>
        <Panel title="Websites sending traffic">
          <Bars rows={asRows(data.referrers)} empty="No outside websites yet — everyone came direct." />
        </Panel>
        <Panel title="Campaigns (utm)">
          <Bars
            rows={data.campaigns.map((c) => ({
              label: c.name,
              sub: [c.source, c.medium].filter(Boolean).join(" · "),
              n: c.visitors,
            }))}
            empty="No tagged links yet. Add ?utm_source=instagram&utm_campaign=name to a link you share."
          />
        </Panel>
        <Panel title="Countries">
          <Bars rows={asRows(data.countries, countryName)} />
        </Panel>
        <Panel title="States / regions">
          <Bars
            rows={data.regions.map((r) => ({
              label: r.name,
              sub: r.country ? countryName(r.country) : undefined,
              n: r.visitors,
            }))}
          />
        </Panel>
        <Panel title="Cities">
          <Bars rows={data.cities.map((c) => ({ label: c.name, sub: c.region ?? undefined, n: c.visitors }))} />
        </Panel>
        <Panel title="Top pages">
          <Bars rows={data.pages.map((p) => ({ label: p.name, n: p.views }))} unit="views" />
        </Panel>
        <Panel title="Devices">
          <Bars rows={asRows(data.devices)} />
        </Panel>
      </div>
    </>
  );
}
