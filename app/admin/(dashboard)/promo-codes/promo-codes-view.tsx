"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  upsertPromoCode,
  setPromoCodeActive,
  type AdminPromoCode,
  type PromoScope,
  type ScopeOption,
} from "@/lib/promo-admin";
import { PageHeader, Panel, RowHead, Row, Cell, EmptyState, Pill, rupees } from "../admin-ui";

const inputClass =
  "h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold outline-none focus:border-brand";
const labelClass = "flex flex-col gap-1.5 text-[12px] font-bold text-muted";

const COLS = "md:grid-cols-[1fr_1.3fr_1fr_100px_100px_140px]";

/** "₹200 off" / "10% off" / "FIRSTGO" alone if somehow neither is set. */
function discountLabel(c: Pick<AdminPromoCode, "discountType" | "discountPaise" | "discountPercentBps">) {
  if (c.discountType === "percent" && c.discountPercentBps != null) {
    return `${c.discountPercentBps / 100}% off`;
  }
  if (c.discountPaise != null) return `${rupees(c.discountPaise)} off`;
  return "—";
}

function scopeLabel(scopes: PromoScope[], options: ScopeOption[]) {
  if (scopes.length === 0) return "All activities & trips";
  const bySlug = new Map(options.map((o) => [`${o.kind}:${o.slug}`, o.label]));
  return scopes.map((s) => bySlug.get(`${s.kind}:${s.slug}`) ?? s.slug).join(", ");
}

export default function PromoCodesView({
  codes,
  scopeOptions,
}: {
  codes: AdminPromoCode[];
  scopeOptions: ScopeOption[];
}) {
  return (
    <>
      <PageHeader
        title="Promo codes"
        subtitle="Codes a traveller can apply at checkout — Activities and Trips only, for now. Scope one to a specific listing, or leave it open to any of them; show it on the public offers page, or keep it just between whoever has the code."
      />
      <CodesPanel codes={codes} scopeOptions={scopeOptions} />
    </>
  );
}

function CodesPanel({ codes, scopeOptions }: { codes: AdminPromoCode[]; scopeOptions: ScopeOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminPromoCode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const togglePause = async (c: AdminPromoCode) => {
    setBusyId(c.id);
    await setPromoCodeActive(c.id, !c.active);
    setBusyId(null);
    router.refresh();
  };

  return (
    <Panel title="Codes">
      <RowHead cols={COLS}>
        <span>Code</span>
        <span>Discount</span>
        <span>Applies to</span>
        <span>Status</span>
        <span>Used</span>
        <span />
      </RowHead>

      {codes.length === 0 ? (
        <EmptyState>No codes yet — add the first one below.</EmptyState>
      ) : (
        codes.map((c) => (
          <Row key={c.id} cols={COLS}>
            <Cell label="Code">
              <span className="block text-[13.5px] font-bold">{c.code}</span>
              {!c.isPublic && (
                <span className="block text-[11px] font-semibold text-muted">Not on offers page</span>
              )}
            </Cell>
            <Cell label="Discount">
              <span className="block text-[13px] font-semibold">{discountLabel(c)}</span>
              {c.minOrderPaise > 0 && (
                <span className="block text-[11.5px] font-medium text-muted">
                  Min. order {rupees(c.minOrderPaise)}
                </span>
              )}
            </Cell>
            <Cell label="Applies to">
              <span className="block text-[12px] font-semibold">
                {scopeLabel(c.scopes, scopeOptions)}
              </span>
            </Cell>
            <Cell label="Status">
              <Pill tone={c.active ? "live" : "down"}>{c.active ? "Live" : "Paused"}</Pill>
            </Cell>
            <Cell label="Used">
              <span className="block text-[12px] font-semibold text-muted">
                {c.redemptionCount} time{c.redemptionCount === 1 ? "" : "s"}
              </span>
            </Cell>
            <Cell className="flex gap-2 md:justify-end">
              <button
                type="button"
                onClick={() => setEditing(c)}
                className="h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busyId === c.id}
                onClick={() => togglePause(c)}
                className="h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-warn disabled:opacity-50"
              >
                {busyId === c.id ? "…" : c.active ? "Pause" : "Reactivate"}
              </button>
            </Cell>
          </Row>
        ))
      )}

      <div className="border-t border-hairline p-5">
        <CodeForm
          key={editing?.id ?? "new"}
          editing={editing}
          scopeOptions={scopeOptions}
          onDone={() => setEditing(null)}
        />
      </div>
    </Panel>
  );
}

function CodeForm({
  editing,
  scopeOptions,
  onDone,
}: {
  editing: AdminPromoCode | null;
  scopeOptions: ScopeOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(editing?.code ?? "");
  const [discountType, setDiscountType] = useState<"flat" | "percent">(editing?.discountType ?? "flat");
  const [rupeesDiscount, setRupeesDiscount] = useState(
    editing?.discountPaise != null ? String(Math.round(editing.discountPaise / 100)) : "",
  );
  const [percentDiscount, setPercentDiscount] = useState(
    editing?.discountPercentBps != null ? String(editing.discountPercentBps / 100) : "",
  );
  const [rupeesMinOrder, setRupeesMinOrder] = useState(
    editing && editing.minOrderPaise > 0 ? String(Math.round(editing.minOrderPaise / 100)) : "",
  );
  const [isPublic, setIsPublic] = useState(editing?.isPublic ?? true);
  const [headline, setHeadline] = useState(editing?.headline ?? "");
  const [scopeKeys, setScopeKeys] = useState<Set<string>>(
    () => new Set((editing?.scopes ?? []).map((s) => `${s.kind}:${s.slug}`)),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const activityOptions = useMemo(() => scopeOptions.filter((o) => o.kind === "activity"), [scopeOptions]);
  const tripOptions = useMemo(() => scopeOptions.filter((o) => o.kind === "trip"), [scopeOptions]);

  const toggleScope = (key: string) =>
    setScopeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async () => {
    const discountPaise = discountType === "flat" ? Math.round(Number(rupeesDiscount) * 100) : null;
    const discountPercentBps = discountType === "percent" ? Math.round(Number(percentDiscount) * 100) : null;

    if (!code.trim()) {
      setProblem("Give this code a value.");
      return;
    }
    if (discountType === "flat" && (!Number.isFinite(discountPaise) || (discountPaise ?? 0) <= 0)) {
      setProblem("Enter a discount amount greater than zero.");
      return;
    }
    if (
      discountType === "percent" &&
      (!Number.isFinite(discountPercentBps) || (discountPercentBps ?? 0) <= 0 || (discountPercentBps ?? 0) > 10000)
    ) {
      setProblem("Enter a percentage between 1 and 100.");
      return;
    }

    const minOrderPaise = rupeesMinOrder.trim() === "" ? 0 : Math.round(Number(rupeesMinOrder) * 100);
    const scopes: PromoScope[] = [...scopeKeys].map((key) => {
      const [kind, slug] = key.split(":") as [PromoScope["kind"], string];
      return { kind, slug };
    });

    setBusy(true);
    setProblem(null);
    const result = await upsertPromoCode({
      id: editing?.id,
      code,
      discountType,
      discountPaise,
      discountPercentBps,
      minOrderPaise,
      isPublic,
      headline,
      active: editing?.active ?? true,
      scopes,
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    if (!editing) {
      setCode("");
      setRupeesDiscount("");
      setPercentDiscount("");
      setRupeesMinOrder("");
      setHeadline("");
      setScopeKeys(new Set());
    }
    onDone();
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
        {editing ? `Editing "${editing.code}"` : "Add a code"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Code (what the traveller types)
          <input
            className={`${inputClass} uppercase`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="FIRSTGO"
          />
        </label>
        <label className={labelClass}>
          Discount type
          <select
            className={inputClass}
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as "flat" | "percent")}
          >
            <option value="flat">Flat amount off</option>
            <option value="percent">Percentage off</option>
          </select>
        </label>
        {discountType === "flat" ? (
          <label className={labelClass}>
            Discount (₹)
            <input
              type="number"
              min="1"
              className={inputClass}
              value={rupeesDiscount}
              onChange={(e) => setRupeesDiscount(e.target.value)}
              placeholder="200"
            />
          </label>
        ) : (
          <label className={labelClass}>
            Discount (%)
            <input
              type="number"
              min="1"
              max="100"
              className={inputClass}
              value={percentDiscount}
              onChange={(e) => setPercentDiscount(e.target.value)}
              placeholder="10"
            />
          </label>
        )}
        <label className={labelClass}>
          Minimum order (₹) <span className="font-medium normal-case">(blank = no minimum)</span>
          <input
            type="number"
            min="0"
            className={inputClass}
            value={rupeesMinOrder}
            onChange={(e) => setRupeesMinOrder(e.target.value)}
            placeholder="15000"
          />
        </label>
        <label className={labelClass}>
          Headline on the offers page <span className="font-medium normal-case">(optional)</span>
          <input
            className={inputClass}
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="10% off scuba diving, on orders over ₹15,000"
          />
        </label>
        <label className="flex items-center gap-2.5 pt-6 text-[13px] font-semibold">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-brand"
          />
          Show on the public offers page
        </label>
      </div>

      <div>
        <p className="text-[12px] font-bold text-muted">
          Applies to <span className="font-medium normal-case">(none picked = any activity or trip)</span>
        </p>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-line bg-ground p-3">
          {activityOptions.length === 0 && tripOptions.length === 0 ? (
            <p className="text-[12px] font-medium text-muted">Nothing listed yet.</p>
          ) : (
            <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {activityOptions.map((o) => {
                const key = `activity:${o.slug}`;
                return (
                  <label key={key} className="flex items-center gap-2 text-[12.5px] font-medium">
                    <input
                      type="checkbox"
                      checked={scopeKeys.has(key)}
                      onChange={() => toggleScope(key)}
                      className="h-3.5 w-3.5 rounded border-line accent-brand"
                    />
                    {o.label}
                  </label>
                );
              })}
              {tripOptions.map((o) => {
                const key = `trip:${o.slug}`;
                return (
                  <label key={key} className="flex items-center gap-2 text-[12.5px] font-medium">
                    <input
                      type="checkbox"
                      checked={scopeKeys.has(key)}
                      onChange={() => toggleScope(key)}
                      className="h-3.5 w-3.5 rounded border-line accent-brand"
                    />
                    {o.label} <span className="text-muted">(trip)</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {problem && <p className="text-[12px] font-bold text-warn">{problem}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="h-10 rounded-xl bg-brand px-4 text-[12.5px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Add code"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onDone}
            className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-ink"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
