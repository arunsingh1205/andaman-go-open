import { getAdminPromoCodes, getPromoScopeOptions } from "@/lib/promo-admin";
import PromoCodesView from "./promo-codes-view";

// Create/pause the promo codes (158, scope/percent/minimum-order 160) a
// traveller can apply at checkout on the Activities and Trips booking
// panels — FIRSTGO and whatever comes after it get made here, not by hand
// in SQL. A code can be a flat amount or a percentage, limited to one or a
// few specific listings (an operator's own requested discount) or left
// open to any Activity/Trip, and shown or hidden on the public /offers page.

export const dynamic = "force-dynamic";

export default async function AdminPromoCodesPage() {
  const [codes, scopeOptions] = await Promise.all([getAdminPromoCodes(), getPromoScopeOptions()]);
  return <PromoCodesView codes={codes} scopeOptions={scopeOptions} />;
}
