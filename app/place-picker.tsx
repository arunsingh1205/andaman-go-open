"use client";

// A Google-Maps-style typeahead over the app's own list of named places
// (cab_places). The traveller starts typing an address and picks a suggestion;
// matching runs over the label AND the aliases, so "airport" finds "Veer
// Savarkar International Airport". No external API — the list is ~30 rows and
// travels to the client whole.
//
// Reused by the operator route editor in the partner app.

import { useMemo, useRef, useState } from "react";
import { PinIcon, SearchIcon } from "@/app/icons";

export type PickerPlace = {
  id: string;
  label: string;
  island: string;
  isAirport: boolean;
  aliases: string[];
};

export default function PlacePicker({
  places,
  value,
  onChange,
  placeholder = "Search an address or landmark",
  exclude,
}: {
  places: PickerPlace[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** A place id to hide (e.g. the one already chosen as the other end). */
  exclude?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = places.find((p) => p.id === value) ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = places.filter((p) => p.id !== exclude);
    if (!q) return pool.slice(0, 8);
    return pool
      .filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          p.aliases.some((a) => a.includes(q)),
      )
      .sort(
        (a, b) =>
          Number(b.label.toLowerCase().startsWith(q)) -
          Number(a.label.toLowerCase().startsWith(q)),
      )
      .slice(0, 8);
  }, [places, query, exclude]);

  const pick = (p: PickerPlace) => {
    onChange(p.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex h-12 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 focus-within:border-brand">
        {selected ? (
          <PinIcon size={16} className="shrink-0 text-brand" />
        ) : (
          <SearchIcon size={16} className="shrink-0 text-muted" />
        )}
        <input
          type="text"
          inputMode="search"
          value={open ? query : (selected?.label ?? query)}
          placeholder={placeholder}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (selected) onChange(null);
          }}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-ink placeholder:font-medium placeholder:text-muted focus:outline-none"
        />
        {(selected || query) && (
          <button
            type="button"
            aria-label="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
            className="shrink-0 text-[12px] font-bold text-muted"
          >
            Clear
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-ground"
              >
                <PinIcon size={15} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">
                    {p.label}
                  </span>
                  <span className="block truncate text-[11.5px] font-medium text-muted">
                    {p.island}
                    {p.isAirport ? " · Airport" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
