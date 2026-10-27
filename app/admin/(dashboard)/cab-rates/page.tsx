import { getAdminCabRates } from "@/lib/cab-rate-admin";
import { getCabPlaces } from "@/lib/cabs";
import CabRatesView from "./cab-rates-view";

// The one thing about cab dispatch that's genuinely Andaman Go's own, not a
// partner's: the standardized rate card (077/078) a rate-card booking is
// priced against. Which operator ends up running a given trip is handled on
// the Bookings page instead — that's now just handing the job to one of the
// existing partner-cab accounts, the same ones this rate card doesn't touch.

export const dynamic = "force-dynamic";

export default async function AdminCabRatesPage() {
  const [rates, places] = await Promise.all([getAdminCabRates(), getCabPlaces()]);

  return <CabRatesView rates={rates} places={places} />;
}
