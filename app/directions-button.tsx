// One "Directions" button. It goes to Google Maps — the app most people here
// already have, and the one with real coverage of small places like Havelock.
// On a phone with the Google Maps app the link opens it natively; otherwise it
// opens Google Maps on the web, which works fine. If the operator gave us their
// own Maps pin, that wins.
//
// Plain component, no platform sniffing: the web can't read a device's default
// map app anyway, and second-guessing it is worse than one predictable choice.

import type { Directions } from "@/lib/bookings";
import { DirectionsIcon } from "@/app/icons";

function googleDirections(query: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

export default function DirectionsButton({
  directions,
  className,
}: {
  directions: Directions;
  className?: string;
}) {
  return (
    <a
      href={directions.mapsUrl ?? googleDirections(directions.query)}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[12px] font-bold text-brand"
      }
    >
      <DirectionsIcon size={15} />
      Directions
    </a>
  );
}
