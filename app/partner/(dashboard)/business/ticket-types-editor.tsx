"use client";

// The "Ticket types" block of the event forms — Single, Couple, Stag, Group,
// Family, whatever the host sells. Shared by the add and edit forms (and so by
// the admin versions of both). Nothing here talks to the database; the forms
// turn the drafts into EventTicketInput[] with toTicketInputs().

import type { EventTicketInput } from "@/lib/partner-register";

export type TicketDraft = {
  name: string;
  description: string;
  /** Rupees as typed — blank until the host fills it in. */
  price: string;
  /** People one pass admits, as typed. */
  people: string;
};

const MAX_TICKETS = 10;

const PRESETS: { label: string; draft: TicketDraft }[] = [
  { label: "Single", draft: { name: "Single Entry", description: "", price: "", people: "1" } },
  { label: "Couple", draft: { name: "Couple Pass", description: "", price: "", people: "2" } },
  { label: "Stag", draft: { name: "Stag Entry", description: "Men entering alone", price: "", people: "1" } },
  { label: "Group of 5", draft: { name: "Group Pass", description: "", price: "", people: "5" } },
  { label: "Family of 10", draft: { name: "Family / Group Pass", description: "", price: "", people: "10" } },
];

const input =
  "h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-[14px] font-semibold outline-none focus:border-brand";
const labelText = "text-[11.5px] font-bold text-muted";

export function fromTicketInputs(tickets: EventTicketInput[]): TicketDraft[] {
  return tickets.map((t) => ({
    name: t.name,
    description: t.description,
    price: String(t.pricePaise / 100),
    people: String(t.people),
  }));
}

export function toTicketInputs(drafts: TicketDraft[]): EventTicketInput[] {
  return drafts.map((d) => ({
    name: d.name.trim(),
    description: d.description.trim(),
    pricePaise: Math.round(parseFloat(d.price) * 100),
    people: parseInt(d.people, 10),
  }));
}

export function ticketsValid(drafts: TicketDraft[]): boolean {
  if (drafts.length > MAX_TICKETS) return false;
  return toTicketInputs(drafts).every(
    (t) =>
      t.name !== "" &&
      t.name.length <= 60 &&
      Number.isFinite(t.pricePaise) &&
      t.pricePaise >= 0 &&
      Number.isInteger(t.people) &&
      t.people >= 1 &&
      t.people <= 50,
  );
}

/** The cheapest pass in paise — what the event is listed "from". */
export function cheapestPaise(drafts: TicketDraft[]): number {
  return Math.min(...toTicketInputs(drafts).map((t) => t.pricePaise));
}

export default function TicketTypesEditor({
  value,
  onChange,
}: {
  value: TicketDraft[];
  onChange: (next: TicketDraft[]) => void;
}) {
  const update = (i: number, patch: Partial<TicketDraft>) =>
    onChange(value.map((t, n) => (n === i ? { ...t, ...patch } : t)));
  const remove = (i: number) => onChange(value.filter((_, n) => n !== i));
  const add = (draft: TicketDraft) => value.length < MAX_TICKETS && onChange([...value, { ...draft }]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div>
        <span className="text-[13px] font-bold">Ticket types</span>
        <p className="mt-1 text-[11.5px] leading-relaxed font-medium text-muted">
          Sell passes like Single, Couple, Stag or Family. Each has its own price and says how
          many people it admits. Leave this empty to charge one flat price per person.
        </p>
      </div>

      {value.map((t, i) => (
        <div key={i} className="flex flex-col gap-2.5 rounded-xl border border-line bg-ground p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-brand">Ticket {i + 1}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-[12px] font-bold text-warn"
            >
              Remove
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <span className={labelText}>Name</span>
            <input
              value={t.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Couple Pass"
              maxLength={60}
              className={input}
            />
          </label>

          <div className="flex gap-2.5">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={labelText}>Price (₹)</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={t.price}
                onChange={(e) => update(i, { price: e.target.value })}
                placeholder="349"
                className={input}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={labelText}>People it admits</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                value={t.people}
                onChange={(e) => update(i, { people: e.target.value })}
                placeholder="2"
                className={input}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className={labelText}>Note — optional</span>
            <input
              value={t.description}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder="Includes one welcome drink"
              className={input}
            />
          </label>
        </div>
      ))}

      {value.length < MAX_TICKETS && (
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => add(p.draft)}
              className="rounded-full border border-line bg-ground px-3 py-1.5 text-[12px] font-bold text-brand"
            >
              + {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => add({ name: "", description: "", price: "", people: "1" })}
            className="rounded-full border border-line bg-ground px-3 py-1.5 text-[12px] font-bold text-muted"
          >
            + Custom
          </button>
        </div>
      )}
    </div>
  );
}
