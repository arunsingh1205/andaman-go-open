"use server";

// The other side of `partner-actions.ts`: not managing a booking, but
// managing the business itself. Every function here mirrors the RPCs in
// 011-partner-onboarding.sql — look up the caller's own partner_id (or lack
// of one) server-side, never trust anything the client claims about itself.

import { supabaseServer } from "./supabase-server";
import { getPartnerAuthState } from "./partner-auth";
import type { PartnerKind } from "./partner-kind";
import { islandLabel } from "./islands";
import { sendPartnerWelcomeEmail, sendPartnerFirstListingEmail } from "./email";
import { sendPartnerWelcomeWhatsApp } from "./whatsapp";

export type PartnerActionResult<T = unknown> =
  | ({ ok: true; message: string } & T)
  | { ok: false; message: string };

const GENERIC_FAILURE = "Something went wrong. Try again.";

/** The generic message hid which database call failed and why, so a partner
 *  could only report "something went wrong". This logs the real error for the
 *  server logs and tags the message with the step and Postgres code, so a
 *  screenshot of the screen is enough to find the cause. */
function stepFailure(step: string, error: { code?: string; message?: string }): { ok: false; message: string } {
  console.error(`[partner-register] ${step} failed:`, error);
  return { ok: false, message: `${GENERIC_FAILURE} (${step}${error.code ? ` · ${error.code}` : ""})` };
}

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

// ---------------------------------------------------------------------------
// Listing photos — 037. A listing's gallery is written by a second RPC right
// after the add/update, the same two-step shape addPartnerVehicle already
// uses for the security deposit. `kind` is the listing_photos vocabulary:
// "stay" for stays, "ferry" for sailings, "rental" for vehicles.
// The add/update RPCs still take photoPaths[0] as their p_photo_path so the
// cover is set even if this second call fails.
// ---------------------------------------------------------------------------

export type ListingPhotoKind =
  | "activity"
  | "rental"
  | "cab"
  | "event"
  | "trip"
  | "ferry"
  | "stay"
  | "community";

export async function setListingPhotos(
  kind: ListingPhotoKind,
  id: string,
  paths: string[],
  asAdmin = false,
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(asAdmin ? "admin_set_listing_photos" : "set_listing_photos", {
    p_kind: kind,
    p_id: id,
    p_paths: paths,
  });
  if (error) return stepFailure("set_listing_photos", error);
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

/** One pass as the partner types it into the form. */
export type EventTicketInput = {
  name: string;
  description: string;
  pricePaise: number;
  people: number;
};

/** Replaces an event's ticket types (153). The database also pins the event's
 *  headline price to the cheapest one. An empty list clears them, putting the
 *  event back on its single entry price. */
export async function setEventTickets(
  eventId: string,
  tickets: EventTicketInput[],
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_event_tickets", {
    p_event_id: eventId,
    p_tickets: tickets,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

async function readEventTickets(eventId: string): Promise<EventTicketInput[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("event_tickets")
    .select("name, description, price_paise, people")
    .eq("event_id", eventId)
    .order("sort_order");
  return (data ?? []).map((t) => ({
    name: t.name as string,
    description: t.description as string,
    pricePaise: t.price_paise as number,
    people: t.people as number,
  }));
}

async function readListingPhotos(kind: ListingPhotoKind, id: string): Promise<string[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("listing_photos")
    .select("storage_path, sort_order")
    .eq("listing_kind", kind)
    .eq("listing_id", id)
    .order("sort_order");
  return (data ?? []).map((r) => r.storage_path as string);
}

// ---------------------------------------------------------------------------
// Rental pick-up hours — the weekday windows a shop hands vehicles over in
// (035). One row per open day; a missing day means closed. create_booking
// rejects a pick-up outside these, and getRentalDates() reads them to set the
// default pick-up time.
// ---------------------------------------------------------------------------

export type RentalHour = { dow: number; openMins: number; closeMins: number };

export async function getRentalHours(partnerId: string): Promise<RentalHour[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("rental_hours")
    .select("dow, open_mins, close_mins")
    .eq("partner_id", partnerId)
    .order("dow");
  return (data ?? []).map((h) => ({
    dow: h.dow as number,
    openMins: h.open_mins as number,
    closeMins: h.close_mins as number,
  }));
}

export async function setRentalHours(hours: RentalHour[]): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_rental_hours", {
    p_slots: hours.map((h) => ({
      dow: h.dow,
      open_mins: h.openMins,
      close_mins: h.closeMins,
    })),
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export async function registerPartner(input: {
  name: string;
  kind: PartnerKind;
  islandSlug: string;
  contactPhone: string;
  address: string;
  mapsUrl: string;
  ownerEmail: string;
  /** The Partner Agreement checkbox on the register form. register_partner
   *  (069) refuses to create the business unless this is true, and stamps
   *  the row with when it was accepted. */
  termsAccepted: boolean;
}): Promise<PartnerActionResult<{ partnerId: string }>> {
  // The only action on this side a stranger can reach, so it checks who's
  // asking rather than trusting the screen it came from. An anonymous
  // account — which every traveller's browser is handed on first load —
  // reads as signed-out here, and can't put a pending business in the
  // catalogue (059 says the same thing at the database).
  const state = await getPartnerAuthState();
  if (state.status === "signed-out") {
    return { ok: false, message: "Sign in with Google before registering your business." };
  }

  if (!input.termsAccepted) {
    return { ok: false, message: "Please read and accept the Partner Agreement to register." };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("register_partner", {
    p_name: input.name,
    p_kind: input.kind,
    p_island_slug: input.islandSlug,
    p_contact_phone: input.contactPhone,
    p_address: input.address,
    p_maps_url: input.mapsUrl || null,
    p_owner_email: input.ownerEmail || null,
    p_terms_accepted: input.termsAccepted,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string; partner_id: string | null }>(data);
  if (!row?.ok || !row.partner_id) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  // Awaited, not fire-and-forget: a Server Action's execution environment
  // can be frozen by the platform the instant its response is sent, which
  // silently kills any promise still in flight — including the send itself
  // and the record_notification call logging it (found via the ops
  // onboarding flow hitting this exact bug: partner created, zero
  // notification_log rows, not even a "failed" one). A failed send still
  // never fails registration itself — caught and logged below — it's just
  // guaranteed to actually run now.
  const { data: userResult } = await supabase.auth.getUser();
  const ownerEmail = userResult?.user?.email ?? null;

  // whatsapp_number is admin-set only (no signup field for it yet), so this
  // is null for every brand-new partner today — kept here for the case an
  // admin later adds one and re-runs the welcome backfill, and so this path
  // matches booking/settlement's email+WhatsApp pattern.
  const { data: partnerRow } = await supabase
    .from("partners")
    .select("whatsapp_number")
    .eq("id", row.partner_id)
    .maybeSingle();
  const whatsappNumber = partnerRow?.whatsapp_number ?? null;

  await Promise.all([
    ownerEmail
      ? sendPartnerWelcomeEmail(ownerEmail, input.name)
          .then((sent) =>
            supabase.rpc("record_notification", {
              p_channel: "email",
              p_recipient_type: "partner",
              p_recipient_address: ownerEmail,
              p_kind: "partner_welcome",
              p_status: sent ? "sent" : "failed",
              p_payload: { partner_name: input.name },
              p_partner_id: row.partner_id,
            }),
          )
          .catch((err) => console.error("welcome email failed:", err))
      : Promise.resolve(),
    whatsappNumber
      ? sendPartnerWelcomeWhatsApp(whatsappNumber, input.name)
          .then((sent) =>
            supabase.rpc("record_notification", {
              p_channel: "whatsapp",
              p_recipient_type: "partner",
              p_recipient_address: whatsappNumber,
              p_kind: "partner_welcome",
              p_status: sent ? "sent" : "failed",
              p_payload: { partner_name: input.name },
              p_partner_id: row.partner_id,
            }),
          )
          .catch((err) => console.error("welcome whatsapp failed:", err))
      : Promise.resolve(),
  ]);

  return { ok: true, message: row.message, partnerId: row.partner_id };
}

// ---------------------------------------------------------------------------
// First-listing email — the commission-guide PDF, sent once per partner the
// first time they add ANY listing (any category below), regardless of
// business/listing approval status (119-partner-first-listing-email.sql).
// The claim_first_listing_email RPC (121) is the one-shot gate: only the
// call that actually flips first_listing_email_sent false -> true sends, so
// two listings added back-to-back (even different categories, even a race)
// can't double-send. partners has no RLS UPDATE policy (027's own pattern —
// every write goes through a SECURITY DEFINER RPC), so this can't be a plain
// `.from("partners").update(...)`; that was tried first and silently no-opped
// under RLS. Same fire-and-forget + record_notification logging shape as the
// partner_welcome email in registerPartner() above.
// ---------------------------------------------------------------------------

async function maybeSendFirstListingEmail(): Promise<void> {
  const state = await getPartnerAuthState();
  if (state.status !== "linked") return;
  const { partnerId, partnerName } = state.session;

  const supabase = await supabaseServer();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_first_listing_email", {
    p_partner_id: partnerId,
  });
  if (claimError) {
    // Same silent-failure shape the backfill hit (124): an RPC error here
    // used to look identical to "already claimed" — no trace anywhere that
    // anything went wrong. Loud in the server log now, still never blocks
    // the listing itself from being added.
    console.error(`claim_first_listing_email failed for ${partnerId}:`, claimError);
    return;
  }
  if (!claimed) return;

  const { data: userResult } = await supabase.auth.getUser();
  const ownerEmail = userResult?.user?.email ?? null;
  if (!ownerEmail) return;

  const { data: partnerRow } = await supabase
    .from("partners")
    .select("commission_bps")
    .eq("id", partnerId)
    .maybeSingle();

  // Awaited for the same reason registerPartner()'s welcome send is —
  // every caller of this helper already awaits it, so fixing it here alone
  // covers all seven addPartner* call sites at once.
  await sendPartnerFirstListingEmail(ownerEmail, partnerName, partnerRow?.commission_bps ?? null)
    .then((sent) =>
      supabase.rpc("record_notification", {
        p_channel: "email",
        p_recipient_type: "partner",
        p_recipient_address: ownerEmail,
        p_kind: "first_listing",
        p_status: sent ? "sent" : "failed",
        p_payload: { partner_name: partnerName },
        p_partner_id: partnerId,
      }),
    )
    .catch((err) => console.error("first-listing email failed:", err));
}

/** The RPC + args for adding a listing. With `forPartnerId` it's the admin_add_*
 *  twin (136), naming the business an admin is adding it for; without, the
 *  partner's own add_partner_* (the business comes from the session). Every
 *  addPartner*(input, forPartnerId?) below goes through this so the two paths
 *  can't drift. Private on purpose — this is a "use server" file, and a
 *  generic RPC caller must not become a client-callable action. */
async function addListingCall(
  kind: "activity" | "vehicle" | "stay" | "event" | "community_service" | "trip" | "sailing",
  args: Record<string, unknown>,
  forPartnerId?: string,
) {
  const supabase = await supabaseServer();
  return forPartnerId
    ? supabase.rpc(`admin_add_${kind}`, { p_partner_id: forPartnerId, ...args })
    : supabase.rpc(`add_partner_${kind}`, args);
}

export type ActivityCategory = "scuba" | "seawalk" | "snorkel" | "water" | "stargazing";

export async function addPartnerActivity(
  input: {
    category: ActivityCategory;
    name: string;
    summary: string;
    about: string;
    pricePaise: number;
    photoPaths: string[];
  },
  forPartnerId?: string,
): Promise<PartnerActionResult<{ activityId: string }>> {
  const { data, error } = await addListingCall(
    "activity",
    {
      p_category: input.category,
      p_name: input.name,
      p_summary: input.summary,
      p_about: input.about,
      p_price_paise: input.pricePaise,
      p_photo_path: input.photoPaths[0] ?? null,
    },
    forPartnerId,
  );
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string; activity_id: string | null }>(data);
  if (!row?.ok || !row.activity_id) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  if (input.photoPaths.length > 0) {
    await setListingPhotos("activity", row.activity_id, input.photoPaths, !!forPartnerId);
  }

  if (!forPartnerId) await maybeSendFirstListingEmail();
  return { ok: true, message: row.message, activityId: row.activity_id };
}

export type VehicleType = "scooter" | "bike" | "bicycle";

export async function addPartnerVehicle(
  input: {
    type: VehicleType;
    model: string;
    ratePaise: number;
    seats: number;
    meta: string;
    units: number;
    securityDepositPaise: number;
    photoPaths: string[];
  },
  forPartnerId?: string,
): Promise<PartnerActionResult<{ vehicleId: string }>> {
  const { data, error } = await addListingCall(
    "vehicle",
    {
      p_type: input.type,
      p_model: input.model,
      p_rate_paise: input.ratePaise,
      p_seats: input.seats,
      p_meta: input.meta,
      p_units: input.units,
      p_photo_path: input.photoPaths[0] ?? null,
    },
    forPartnerId,
  );
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string; vehicle_id: string | null }>(data);
  if (!row?.ok || !row.vehicle_id) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  // The security deposit rides its own RPC (035), set right after creation —
  // for an admin that's the admin_update_vehicle path's deposit RPC.
  if (input.securityDepositPaise > 0) {
    const supabase = await supabaseServer();
    await supabase.rpc(forPartnerId ? "admin_set_vehicle_security_deposit" : "set_vehicle_security_deposit", {
      p_vehicle_id: row.vehicle_id,
      p_paise: input.securityDepositPaise,
    });
  }

  if (input.photoPaths.length > 0) {
    await setListingPhotos("rental", row.vehicle_id, input.photoPaths, !!forPartnerId);
  }

  if (!forPartnerId) await maybeSendFirstListingEmail();
  return { ok: true, message: row.message, vehicleId: row.vehicle_id };
}

// ---------------------------------------------------------------------------
// Stays & homestays — 096/097. Same shape as activities/vehicles above: look
// up the caller's own partner_id server-side, insert with is_listed = false.
// Room types are a separate bulk-replace call (setStayRoomTypes), same
// two-step shape cabs use for routes (add the listing, then set its routes).
// ---------------------------------------------------------------------------

export type StayPropertyType = "homestay" | "guesthouse" | "villa" | "resort" | "hostel" | "hotel";
export type StayCancellationPolicy = "flexible" | "moderate" | "strict";

export type StayInput = {
  name: string;
  /** The island this property is actually on — the partner's own explicit
   *  choice, never inherited from the business profile (100): a partner
   *  running stays on more than one island, or whose business profile
   *  island is stale, must say which island each listing is really on. */
  islandSlug: string;
  propertyType: StayPropertyType;
  area: string;
  tagline: string;
  about: string;
  amenities: string[];
  houseRules: string;
  cancellationPolicy: StayCancellationPolicy;
  checkInMins: number;
  checkOutMins: number;
  photoPaths: string[];
};

export async function addPartnerStay(
  input: StayInput,
  forPartnerId?: string,
): Promise<PartnerActionResult<{ stayId: string }>> {
  const { data, error } = await addListingCall(
    "stay",
    {
      p_name: input.name,
      p_island_slug: input.islandSlug,
      p_property_type: input.propertyType,
      p_area: input.area,
      p_tagline: input.tagline,
      p_about: input.about,
      p_amenities: input.amenities,
      p_house_rules: input.houseRules,
      p_cancellation_policy: input.cancellationPolicy,
      p_check_in_mins: input.checkInMins,
      p_check_out_mins: input.checkOutMins,
      p_photo_path: input.photoPaths[0] ?? null,
    },
    forPartnerId,
  );
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string; stay_id: string | null }>(data);
  if (!row?.ok || !row.stay_id) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  if (input.photoPaths.length > 0) {
    await setListingPhotos("stay", row.stay_id, input.photoPaths, !!forPartnerId);
  }

  if (!forPartnerId) await maybeSendFirstListingEmail();
  return { ok: true, message: row.message, stayId: row.stay_id };
}

export type StayRoomTypeInput = {
  code?: string;
  name: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  nightlyRatePaise: number;
  quantity: number;
  amenities: string[];
};

/** Replace a stay's whole room-type set in one call — operational, does not
 *  bounce a live listing back to pending (same discipline as a cab's routes). */
export async function setStayRoomTypes(
  stayId: string,
  roomTypes: StayRoomTypeInput[],
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_stay_room_types", {
    p_stay_id: stayId,
    p_room_types: roomTypes.map((r) => ({
      code: r.code ?? null,
      name: r.name,
      max_guests: r.maxGuests,
      bedrooms: r.bedrooms,
      beds: r.beds,
      bathrooms: r.bathrooms,
      nightly_rate_paise: r.nightlyRatePaise,
      quantity: r.quantity,
      amenities: r.amenities,
    })),
  });
  if (error) return stepFailure("set_stay_room_types", error);
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export type EventGenre =
  | "dj"
  | "live"
  | "bonfire"
  | "karaoke"
  | "comedy"
  | "drama"
  | "festival"
  | "carnival"
  | "cruise";
export type EventAgeRestriction = "all-ages" | "18+" | "21+";

export async function addPartnerEvent(
  input: {
    genre: EventGenre;
    name: string;
    venue: string;
    area: string;
    /** Which island this event is on — 016 used to copy the partner's island
     *  onto every listing; an event company hosts in more than one place, so
     *  each listing carries its own (071). Blank falls back to the partner's. */
    islandSlug: string;
    /** Optional Google Maps link for this specific venue (071). */
    mapsUrl: string;
    onDate: string;
    timeMins: number;
    /** Approximate end time — optional, descriptive only. */
    endTimeMins: number | null;
    entryPaise: number;
    /** Null means uncapped. */
    capacity: number | null;
    about: string;
    ageRestriction: EventAgeRestriction;
    /** Who's performing — required for 'dj' and 'live' (053). */
    performer: string;
    photoPaths: string[];
    /** Ticket types (153). Empty keeps the single entryPaise. */
    tickets: EventTicketInput[];
    /** Which weekdays it repeats on, 0 (Sun)…6 (Sat) — empty means a
     *  one-off event on `onDate` alone (157). */
    recurDays: number[];
    /** The last night it runs — required (and only meaningful) when
     *  recurDays is non-empty. */
    recurUntil: string | null;
  },
  forPartnerId?: string,
): Promise<PartnerActionResult<{ eventId: string }>> {
  const { data, error } = await addListingCall(
    "event",
    {
      p_genre: input.genre,
      p_name: input.name,
      p_venue: input.venue,
      p_area: input.area,
      p_island_slug: input.islandSlug || null,
      p_maps_url: input.mapsUrl || null,
      p_on_date: input.onDate,
      p_time_mins: input.timeMins,
      p_end_time_mins: input.endTimeMins,
      p_entry_paise: input.entryPaise,
      p_capacity: input.capacity,
      p_about: input.about,
      p_age_restriction: input.ageRestriction,
      p_performer: input.performer,
      p_photo_path: input.photoPaths[0] ?? null,
      p_recur_days: input.recurDays,
      p_recur_until: input.recurUntil,
    },
    forPartnerId,
  );
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string; event_id: string | null }>(data);
  if (!row?.ok || !row.event_id) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  if (input.photoPaths.length > 0) {
    await setListingPhotos("event", row.event_id, input.photoPaths, !!forPartnerId);
  }

  if (input.tickets.length > 0) {
    const tickets = await setEventTickets(row.event_id, input.tickets);
    if (!tickets.ok) return tickets;
  }

  if (!forPartnerId) await maybeSendFirstListingEmail();
  return { ok: true, message: row.message, eventId: row.event_id };
}

// ---------------------------------------------------------------------------
// Community Service — free activities a local community or NGO runs (beach
// cleanups, volunteer days, drives). 072-community-service.sql. Same self-serve shape as
// events: owner-only RPC, look up the caller's partner_id server-side, insert
// with is_listed = false. Photos go through the shared gallery (037/148),
// the same two-step add/update-then-setListingPhotos every other kind uses —
// add_partner_community_service and update_partner_community_service never
// took a p_photo_path, so there's no first-step cover to pass either.
// ---------------------------------------------------------------------------

export type CommunityServiceInput = {
  name: string;
  organizerName: string;
  about: string;
  /** Which island it's on — blank falls back to the partner's own. */
  islandSlug: string;
  /** Optional Google Maps pin for the meeting point. */
  mapsUrl: string;
  onDate: string;
  timeMins: number;
  /** Approximate end time — optional, descriptive only. */
  endTimeMins: number | null;
  meetingPoint: string;
  whatToBring: string;
  safetyNotes: string;
  /** Age limits — either, both, or neither. */
  minAge: number | null;
  maxAge: number | null;
  contactName: string;
  contactPhone: string;
  /** Organiser's WhatsApp group invite link, shown after a sign-up. */
  whatsappGroupUrl: string;
  /** Cover first (148) — also what the shared link's preview card shows. */
  photoPaths: string[];
};

function communityRpcArgs(input: CommunityServiceInput) {
  return {
    p_name: input.name,
    p_organizer_name: input.organizerName,
    p_about: input.about,
    p_on_date: input.onDate,
    p_time_mins: input.timeMins,
    p_end_time_mins: input.endTimeMins,
    p_island_slug: input.islandSlug || null,
    p_maps_url: input.mapsUrl || null,
    p_meeting_point: input.meetingPoint,
    p_what_to_bring: input.whatToBring || null,
    p_safety_notes: input.safetyNotes || null,
    p_min_age: input.minAge,
    p_max_age: input.maxAge,
    p_contact_name: input.contactName,
    p_contact_phone: input.contactPhone,
    p_whatsapp_group_url: input.whatsappGroupUrl || null,
  };
}

export async function addPartnerCommunityService(
  input: CommunityServiceInput,
  forPartnerId?: string,
): Promise<PartnerActionResult<{ communityServiceId: string }>> {
  const { data, error } = await addListingCall("community_service", communityRpcArgs(input), forPartnerId);
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string; community_service_id: string | null }>(data);
  if (!row?.ok || !row.community_service_id) {
    return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  }

  if (input.photoPaths.length > 0) {
    await setListingPhotos("community", row.community_service_id, input.photoPaths, !!forPartnerId);
  }

  if (!forPartnerId) await maybeSendFirstListingEmail();
  return { ok: true, message: row.message, communityServiceId: row.community_service_id };
}

export type CommunityServiceDetail = CommunityServiceInput & { id: string };

export async function getOwnCommunityService(
  partnerId: string,
  id: string,
): Promise<CommunityServiceDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("community_services")
    .select(
      "id, name, organizer_name, about, island_slug, maps_url, on_date, time_mins, end_time_mins, meeting_point, what_to_bring, safety_notes, min_age, max_age, contact_name, contact_phone, whatsapp_group_url",
    )
    .eq("id", id)
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    organizerName: data.organizer_name,
    about: data.about ?? "",
    islandSlug: data.island_slug,
    mapsUrl: data.maps_url ?? "",
    onDate: data.on_date,
    timeMins: data.time_mins,
    endTimeMins: data.end_time_mins,
    meetingPoint: data.meeting_point,
    whatToBring: data.what_to_bring ?? "",
    safetyNotes: data.safety_notes ?? "",
    minAge: data.min_age,
    maxAge: data.max_age,
    contactName: data.contact_name,
    contactPhone: data.contact_phone,
    whatsappGroupUrl: data.whatsapp_group_url ?? "",
    photoPaths: await readListingPhotos("community", data.id),
  };
}

export async function updatePartnerCommunityService(
  id: string,
  input: CommunityServiceInput,
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_partner_community_service", {
    p_id: id,
    ...communityRpcArgs(input),
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  const photos = await setListingPhotos("community", id, input.photoPaths);
  if (!photos.ok) return photos;

  return { ok: true, message: row.message };
}

export async function addPartnerTrip(
  input: {
    title: string;
    hostName: string;
    hostSince: string;
    durationLabel: string;
    runsOnDays: number[];
    runDates: string[];
    departsMins: number;
    /** Approximate return time — optional, descriptive only. */
    endsMins: number | null;
    pricePaise: number;
    difficulty: "easy" | "moderate" | "challenging";
    minSeats: number;
    /** Null means uncapped. */
    seatsTotal: number | null;
    summary: string;
    includes: string[];
    bringList: string[];
    meetPoint: string;
    meetAtHotel: boolean;
    mapsUrl: string;
    photoPaths: string[];
  },
  forPartnerId?: string,
): Promise<PartnerActionResult<{ tripId: string }>> {
  const { data, error } = await addListingCall(
    "trip",
    {
      p_title: input.title,
      p_host_name: input.hostName,
      p_host_since: input.hostSince,
      p_duration_label: input.durationLabel,
      p_runs_on_days: input.runsOnDays,
      p_price_paise: input.pricePaise,
      p_difficulty: input.difficulty,
      p_min_seats: input.minSeats,
      p_seats_total: input.seatsTotal,
      p_summary: input.summary,
      p_includes: input.includes,
      p_bring_list: input.bringList,
      p_meet_point: input.meetPoint,
      p_photo_path: input.photoPaths[0] ?? null,
      p_departs_mins: input.departsMins,
      p_run_dates: input.runDates,
      p_meet_at_hotel: input.meetAtHotel,
      p_maps_url: input.mapsUrl,
      p_ends_mins: input.endsMins,
    },
    forPartnerId,
  );
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string; trip_id: string | null }>(data);
  if (!row?.ok || !row.trip_id) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  if (input.photoPaths.length > 0) {
    await setListingPhotos("trip", row.trip_id, input.photoPaths, !!forPartnerId);
  }

  if (!forPartnerId) await maybeSendFirstListingEmail();
  return { ok: true, message: row.message, tripId: row.trip_id };
}

export type BadgeTone = "good" | "warm" | "plain";

export async function addPartnerSailing(
  input: {
    fromIsland: string;
    toIsland: string;
    styleLabel: string;
    depMins: number;
    durationMins: number;
    farePaise: number;
    capacity: number;
    daysOfWeek: number[];
    styleTone: BadgeTone;
    info: string;
    infoWarn: boolean;
    photoPaths: string[];
  },
  forPartnerId?: string,
): Promise<PartnerActionResult<{ sailingId: string }>> {
  const { data, error } = await addListingCall(
    "sailing",
    {
      p_from_island: input.fromIsland,
      p_to_island: input.toIsland,
      p_style_label: input.styleLabel,
      p_dep_mins: input.depMins,
      p_duration_mins: input.durationMins,
      p_fare_paise: input.farePaise,
      p_capacity: input.capacity,
      p_days_of_week: input.daysOfWeek,
      p_style_tone: input.styleTone,
      p_info: input.info,
      p_info_warn: input.infoWarn,
      p_photo_path: input.photoPaths[0] ?? null,
    },
    forPartnerId,
  );
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string; sailing_id: string | null }>(data);
  if (!row?.ok || !row.sailing_id) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  if (input.photoPaths.length > 0) {
    await setListingPhotos("ferry", row.sailing_id, input.photoPaths, !!forPartnerId);
  }

  if (!forPartnerId) await maybeSendFirstListingEmail();
  return { ok: true, message: row.message, sailingId: row.sailing_id };
}

export async function updatePartnerProfile(input: {
  address: string;
  mapsUrl: string;
  coverPhotoPath: string | null;
  licenseNumber: string;
  licenseDocPath: string | null;
  area: string;
}): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_partner_profile", {
    p_address: input.address,
    p_maps_url: input.mapsUrl,
    p_cover_photo_path: input.coverPhotoPath,
    p_license_number: input.licenseNumber,
    p_license_doc_path: input.licenseDocPath,
    p_area: input.area,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

// ---------------------------------------------------------------------------
// Reading back what a partner has already submitted, for the Listings tab.
// Relies on the "partner sees own X" RLS policies from 011/016 — no RPC
// needed, a plain scoped select is enough since RLS already limits it to
// their rows. `kind` values match what booking_items.kind and the
// admin_approve_listing/admin_reject_listing/resubmit_partner_listing RPCs
// already use — "stay" for stays, "ferry" for sailings.
// ---------------------------------------------------------------------------

export type OwnListing = {
  id: string;
  kind: "activity" | "rental" | "cab" | "stay" | "event" | "trip" | "ferry" | "community";
  title: string;
  detail: string;
  isListed: boolean;
  rejectionReason: string | null;
  /** An activity with no schedule rows, or a stay with no room types yet —
   *  can't be booked, and admin approval is blocked until they're added
   *  (038/096). Always false for the other kinds, which carry their
   *  recurrence on the row. */
  needsTimes: boolean;
};

export async function getPartnerListings(partnerId: string): Promise<OwnListing[]> {
  const supabase = await supabaseServer();

  const [activities, vehicles, cabs, stays, events, trips, sailings, communityServices] =
    await Promise.all([
      supabase
        .from("activities")
        .select("id, name, category, price_paise, is_listed, rejection_reason")
        .eq("partner_id", partnerId)
        .is("deleted_at", null),
      supabase
        .from("vehicles")
        .select("id, model, type, rate_paise, units, is_listed, rejection_reason")
        .eq("partner_id", partnerId)
        .is("deleted_at", null),
      supabase
        .from("cabs")
        .select("id, model, category, full_day_paise, is_listed, rejection_reason")
        .eq("partner_id", partnerId)
        .is("deleted_at", null),
      supabase
        .from("stays")
        .select("id, name, property_type, is_listed, rejection_reason, stay_room_types ( nightly_rate_paise )")
        .eq("partner_id", partnerId)
        .is("deleted_at", null),
      supabase
        .from("events")
        .select("id, name, genre, on_date, entry_paise, is_listed, rejection_reason")
        .eq("partner_id", partnerId)
        .is("deleted_at", null),
      supabase
        .from("trips")
        .select("id, title, duration_label, price_paise, is_listed, rejection_reason")
        .eq("partner_id", partnerId)
        .is("deleted_at", null),
      supabase
        .from("sailings")
        .select("id, style_label, from_island, to_island, fare_paise, is_listed, rejection_reason")
        .eq("partner_id", partnerId)
        .is("deleted_at", null),
      supabase
        .from("community_services")
        .select("id, name, on_date, is_listed, rejection_reason")
        .eq("partner_id", partnerId)
        .is("deleted_at", null),
    ]);

  const out: OwnListing[] = [];

  for (const row of activities.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "activity",
      title: row.name as string,
      detail: `${row.category} · ₹${((row.price_paise as number) / 100).toFixed(0)}`,
      isListed: row.is_listed as boolean,
      rejectionReason: row.rejection_reason as string | null,
      needsTimes: false,
    });
  }
  for (const row of vehicles.data ?? []) {
    const units = row.units as number;
    out.push({
      id: row.id as string,
      kind: "rental",
      title: row.model as string,
      // The Business tab is the only place a partner can see this at a
      // glance today — booking-time availability (per pickup date) is
      // customer-facing only, on the shop's booking screen.
      detail: `${row.type} · ₹${((row.rate_paise as number) / 100).toFixed(0)}/day · ${units} in stock`,
      isListed: row.is_listed as boolean,
      rejectionReason: row.rejection_reason as string | null,
      needsTimes: false,
    });
  }
  for (const row of cabs.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "cab",
      title: row.model as string,
      detail: `${row.category} · ₹${((row.full_day_paise as number) / 100).toFixed(0)}/day`,
      isListed: row.is_listed as boolean,
      rejectionReason: row.rejection_reason as string | null,
      needsTimes: false,
    });
  }
  for (const row of stays.data ?? []) {
    const roomTypes = (row.stay_room_types ?? []) as { nightly_rate_paise: number }[];
    const cheapest = roomTypes.length
      ? Math.min(...roomTypes.map((r) => r.nightly_rate_paise))
      : null;
    out.push({
      id: row.id as string,
      kind: "stay",
      title: row.name as string,
      detail:
        `${row.property_type}` +
        (cheapest != null ? ` · ₹${(cheapest / 100).toFixed(0)}/night` : " · no room types yet"),
      isListed: row.is_listed as boolean,
      rejectionReason: row.rejection_reason as string | null,
      needsTimes: roomTypes.length === 0,
    });
  }
  for (const row of events.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "event",
      title: row.name as string,
      detail: `${row.genre} · ${row.on_date} · ₹${((row.entry_paise as number) / 100).toFixed(0)}`,
      isListed: row.is_listed as boolean,
      rejectionReason: row.rejection_reason as string | null,
      needsTimes: false,
    });
  }
  for (const row of trips.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "trip",
      title: row.title as string,
      detail: `${row.duration_label} · ₹${((row.price_paise as number) / 100).toFixed(0)}`,
      isListed: row.is_listed as boolean,
      rejectionReason: row.rejection_reason as string | null,
      needsTimes: false,
    });
  }
  for (const row of sailings.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "ferry",
      title: row.style_label as string,
      detail: `${islandLabel(row.from_island as string)} → ${islandLabel(row.to_island as string)} · ₹${((row.fare_paise as number) / 100).toFixed(0)}`,
      isListed: row.is_listed as boolean,
      rejectionReason: row.rejection_reason as string | null,
      needsTimes: false,
    });
  }
  for (const row of communityServices.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "community",
      title: row.name as string,
      detail: `Community service · ${row.on_date}`,
      isListed: row.is_listed as boolean,
      rejectionReason: row.rejection_reason as string | null,
      needsTimes: false,
    });
  }

  // An activity with no timetable rows can't be booked — flag it so the
  // Business tab can nudge the partner to open the schedule editor (038).
  // (Stays already got their needsTimes set inline above, off the room
  // types fetched in the same query.)
  const activityIds = (activities.data ?? []).map((r) => r.id as string);

  const withActivityTimes = activityIds.length
    ? await supabase.from("activity_schedule").select("activity_id").in("activity_id", activityIds)
    : { data: [] as { activity_id: string }[] };

  const scheduled = new Set<string>(
    ((withActivityTimes.data ?? []) as { activity_id: string }[]).map((r) => `activity-${r.activity_id}`),
  );

  for (const item of out) {
    if (item.kind === "activity") {
      item.needsTimes = !scheduled.has(`${item.kind}-${item.id}`);
    }
  }

  return out;
}

export type OwnBusiness = {
  id: string;
  name: string;
  kind: PartnerKind;
  status: "pending" | "approved" | "suspended" | "rejected" | "deleted";
  rejectionReason: string | null;
  islandSlug: string;
  /** Where the business actually is — a rental shop's own card reads this
   *  directly (127), since a shop has no separate listing row the way an
   *  activity does. */
  area: string | null;
  address: string | null;
  mapsUrl: string | null;
  coverPhotoPath: string | null;
  licenseNumber: string | null;
  licenseDocPath: string | null;
  /** This business's own agreed commission, in basis points (migration 137)
   *  — null until the admin sets one. */
  commissionBps: number | null;
};

export async function getOwnBusiness(partnerId: string): Promise<OwnBusiness | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("partners")
    .select(
      "id, name, kind, status, rejection_reason, island_slug, area, address, maps_url, cover_photo_path, license_number, license_doc_path, commission_bps",
    )
    .eq("id", partnerId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    kind: data.kind,
    status: data.status,
    rejectionReason: data.rejection_reason,
    islandSlug: data.island_slug,
    area: data.area,
    address: data.address,
    mapsUrl: data.maps_url,
    coverPhotoPath: data.cover_photo_path,
    licenseNumber: data.license_number,
    licenseDocPath: data.license_doc_path,
    commissionBps: data.commission_bps,
  };
}

// ---------------------------------------------------------------------------
// Resubmitting after a rejection — the other side of admin_reject_partner /
// admin_reject_listing in 012-admin-review.sql. Clears the reason and puts
// the row back in its pending bucket for another look.
// ---------------------------------------------------------------------------

export async function resubmitPartner(): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("resubmit_partner");
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export async function resubmitPartnerListing(
  kind: OwnListing["kind"],
  id: string,
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("resubmit_partner_listing", { p_kind: kind, p_id: id });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

// ---------------------------------------------------------------------------
// Removing a listing entirely — the partner's own side of 093. Owner-only
// (delete_partner_listing wraps assert_partner_owner, same as every other
// write here), and permanent: it drops out of getPartnerListings() for good
// rather than moving to another bucket, with no resubmit back from it.
// Existing bookings against it are untouched — this only stops new ones.
// ---------------------------------------------------------------------------

export async function deletePartnerListing(
  kind: OwnListing["kind"],
  id: string,
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("delete_partner_listing", { p_kind: kind, p_id: id });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

// ---------------------------------------------------------------------------
// Editing a listing already added — 013-partner-listing-edits.sql (016 for
// events/trips/sailings, 096 for stays). Reading the full detail is a plain
// scoped select (the "partner sees own X" policies already allow it); every
// write goes through its own update_partner_* RPC, same ownership-check
// discipline as everything else here. Editing a LIVE listing sends it back
// to review — see the RPC's own comment for why — editing a pending or
// rejected one just updates in place.
// ---------------------------------------------------------------------------

export type ActivityDetail = {
  id: string;
  category: ActivityCategory;
  name: string;
  summary: string;
  about: string;
  pricePaise: number;
  /** This listing's own area/address/Maps link (071/127). Empty string
   *  when unset — the listing then falls back to the business profile for
   *  directions, and (for area specifically) for what shows on its card. */
  area: string;
  address: string;
  mapsUrl: string;
  photoPaths: string[];
  /** "window" (pick a time within a range) or "fixed" (exact departure
   *  times) — 090. New activities default to "window". */
  scheduleMode: "window" | "fixed";
};

export async function getOwnActivity(partnerId: string, id: string): Promise<ActivityDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("activities")
    .select("id, category, name, summary, about, price_paise, area, address, maps_url, schedule_mode")
    .eq("id", id)
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    category: data.category,
    name: data.name,
    summary: data.summary,
    about: data.about,
    pricePaise: data.price_paise,
    area: data.area ?? "",
    address: data.address ?? "",
    mapsUrl: data.maps_url ?? "",
    photoPaths: await readListingPhotos("activity", data.id),
    scheduleMode: data.schedule_mode === "fixed" ? "fixed" : "window",
  };
}

/** Switches an activity between window and fixed schedule entry (090). */
export async function setPartnerActivityMode(
  activityId: string,
  mode: "window" | "fixed",
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_activity_mode", {
    p_activity_id: activityId,
    p_mode: mode,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export async function updatePartnerActivity(
  id: string,
  input: { name: string; summary: string; about: string; pricePaise: number; photoPaths: string[] },
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_partner_activity", {
    p_id: id,
    p_name: input.name,
    p_summary: input.summary,
    p_about: input.about,
    p_price_paise: input.pricePaise,
    p_photo_path: input.photoPaths[0] ?? null,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  const photos = await setListingPhotos("activity", id, input.photoPaths);
  if (!photos.ok) return photos;

  return { ok: true, message: row.message };
}

export type VehicleDetail = {
  id: string;
  type: VehicleType;
  model: string;
  ratePaise: number;
  seats: number;
  meta: string;
  units: number;
  securityDepositPaise: number;
  photoPaths: string[];
  /** The shop's own area and map link (128/130) — a vehicle has no location
   *  of its own, the shop it belongs to does, so the vehicle edit screen
   *  reads/writes these straight from the shop's business profile. Both are
   *  required going forward (130), so this screen also enforces that. */
  shopArea: string;
  shopMapsUrl: string;
};

export async function getOwnVehicle(partnerId: string, id: string): Promise<VehicleDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, type, model, rate_paise, seats, meta, units, security_deposit_paise, partners(area, maps_url)")
    .eq("id", id)
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (error || !data) return null;
  const partner = data.partners as
    | { area: string | null; maps_url: string | null }
    | { area: string | null; maps_url: string | null }[]
    | null;
  const p = Array.isArray(partner) ? partner[0] : partner;
  return {
    id: data.id,
    type: data.type,
    model: data.model,
    ratePaise: data.rate_paise,
    seats: data.seats,
    meta: data.meta,
    units: data.units,
    securityDepositPaise: data.security_deposit_paise ?? 0,
    photoPaths: await readListingPhotos("rental", data.id),
    shopArea: p?.area ?? "",
    shopMapsUrl: p?.maps_url ?? "",
  };
}

/** Sets the shop's own area and map link, from the vehicle edit/add screens
 *  — same target columns update_partner_profile writes, just without
 *  needing the rest of the business-profile form loaded (128). Both
 *  required (130). */
export async function setPartnerShopArea(
  area: string,
  mapsUrl: string,
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_shop_area", {
    p_area: area,
    p_maps_url: mapsUrl,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export async function updatePartnerVehicle(
  id: string,
  input: {
    model: string;
    ratePaise: number;
    seats: number;
    meta: string;
    units: number;
    securityDepositPaise: number;
    photoPaths: string[];
  },
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_partner_vehicle", {
    p_id: id,
    p_model: input.model,
    p_rate_paise: input.ratePaise,
    p_seats: input.seats,
    p_meta: input.meta,
    p_units: input.units,
    p_photo_path: input.photoPaths[0] ?? null,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  // The security deposit rides its own RPC (035) — it isn't part of the
  // listing Andaman Go reviews.
  const dep = await supabase.rpc("set_vehicle_security_deposit", {
    p_vehicle_id: id,
    p_paise: input.securityDepositPaise,
  });
  if (dep.error) return { ok: false, message: GENERIC_FAILURE };
  const depRow = firstRow<{ ok: boolean; message: string }>(dep.data);
  if (!depRow?.ok) return { ok: false, message: depRow?.message ?? GENERIC_FAILURE };

  const photos = await setListingPhotos("rental", id, input.photoPaths);
  if (!photos.ok) return photos;

  return { ok: true, message: row.message };
}


export type StayRoomTypeDetail = Omit<StayRoomTypeInput, "code"> & { id: string; code: string };

export type StayDetail = StayInput & {
  id: string;
  /** This listing's own address / Maps link. Empty string when unset — the
   *  listing then falls back to the business profile for directions. */
  address: string;
  mapsUrl: string;
  roomTypes: StayRoomTypeDetail[];
};

export async function getOwnStay(partnerId: string, id: string): Promise<StayDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("stays")
    .select(
      "id, name, island_slug, property_type, area, tagline, about, amenities, house_rules, cancellation_policy, check_in_mins, check_out_mins, address, maps_url, stay_room_types ( id, code, name, max_guests, bedrooms, beds, bathrooms, nightly_rate_paise, quantity, amenities )",
    )
    .eq("id", id)
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    islandSlug: data.island_slug,
    propertyType: data.property_type,
    area: data.area,
    tagline: data.tagline ?? "",
    about: data.about,
    amenities: data.amenities ?? [],
    houseRules: data.house_rules ?? "",
    cancellationPolicy: data.cancellation_policy,
    checkInMins: data.check_in_mins,
    checkOutMins: data.check_out_mins,
    address: data.address ?? "",
    mapsUrl: data.maps_url ?? "",
    photoPaths: await readListingPhotos("stay", data.id),
    roomTypes: ((data.stay_room_types ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
      maxGuests: r.max_guests as number,
      bedrooms: r.bedrooms as number,
      beds: r.beds as number,
      bathrooms: r.bathrooms as number,
      nightlyRatePaise: r.nightly_rate_paise as number,
      quantity: r.quantity as number,
      amenities: (r.amenities as string[] | null) ?? [],
    })),
  };
}

export async function updatePartnerStay(
  id: string,
  input: StayInput,
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_partner_stay", {
    p_id: id,
    p_name: input.name,
    p_island_slug: input.islandSlug,
    p_property_type: input.propertyType,
    p_area: input.area,
    p_tagline: input.tagline,
    p_about: input.about,
    p_amenities: input.amenities,
    p_house_rules: input.houseRules,
    p_cancellation_policy: input.cancellationPolicy,
    p_check_in_mins: input.checkInMins,
    p_check_out_mins: input.checkOutMins,
    p_photo_path: input.photoPaths[0] ?? null,
  });
  if (error) return stepFailure("update_partner_stay", error);
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  const photos = await setListingPhotos("stay", id, input.photoPaths);
  if (!photos.ok) return photos;

  return { ok: true, message: row.message };
}

export type EventDetail = {
  id: string;
  genre: EventGenre;
  name: string;
  venue: string;
  area: string;
  islandSlug: string;
  mapsUrl: string;
  onDate: string;
  timeMins: number;
  /** Approximate end time — optional, descriptive only. */
  endTimeMins: number | null;
  entryPaise: number;
  /** Null means uncapped. */
  capacity: number | null;
  about: string;
  ageRestriction: EventAgeRestriction;
  performer: string | null;
  photoPaths: string[];
  tickets: EventTicketInput[];
  recurDays: number[];
  recurUntil: string | null;
};

export async function getOwnEvent(partnerId: string, id: string): Promise<EventDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, genre, name, venue, area, island_slug, maps_url, on_date, time_mins, end_time_mins, entry_paise, capacity, about, age_restriction, performer, recur_days, recur_until",
    )
    .eq("id", id)
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    genre: data.genre,
    name: data.name,
    venue: data.venue,
    area: data.area,
    islandSlug: data.island_slug,
    mapsUrl: data.maps_url ?? "",
    onDate: data.on_date,
    timeMins: data.time_mins,
    endTimeMins: data.end_time_mins,
    entryPaise: data.entry_paise,
    capacity: data.capacity,
    about: data.about,
    ageRestriction: data.age_restriction,
    performer: data.performer,
    photoPaths: await readListingPhotos("event", data.id),
    tickets: await readEventTickets(data.id),
    recurDays: data.recur_days ?? [],
    recurUntil: data.recur_until,
  };
}

export async function updatePartnerEvent(
  id: string,
  input: {
    name: string;
    venue: string;
    area: string;
    islandSlug: string;
    mapsUrl: string;
    onDate: string;
    timeMins: number;
    /** Approximate end time — optional, descriptive only. */
    endTimeMins: number | null;
    entryPaise: number;
    /** Null means uncapped. */
    capacity: number | null;
    about: string;
    ageRestriction: EventAgeRestriction;
    /** Required only when the event's genre is 'dj' or 'live' — the RPC
     *  knows the genre server-side and enforces it. */
    performer: string;
    photoPaths: string[];
    /** Ticket types (153). Empty keeps the single entryPaise. */
    tickets: EventTicketInput[];
    recurDays: number[];
    recurUntil: string | null;
  },
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_partner_event", {
    p_id: id,
    p_name: input.name,
    p_venue: input.venue,
    p_area: input.area,
    p_island_slug: input.islandSlug || null,
    p_maps_url: input.mapsUrl || null,
    p_on_date: input.onDate,
    p_time_mins: input.timeMins,
    p_end_time_mins: input.endTimeMins,
    p_entry_paise: input.entryPaise,
    p_capacity: input.capacity,
    p_about: input.about,
    p_age_restriction: input.ageRestriction,
    p_performer: input.performer,
    p_photo_path: input.photoPaths[0] ?? null,
    p_recur_days: input.recurDays,
    p_recur_until: input.recurUntil,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  const photos = await setListingPhotos("event", id, input.photoPaths);
  if (!photos.ok) return photos;

  const tickets = await setEventTickets(id, input.tickets);
  if (!tickets.ok) return tickets;

  return { ok: true, message: row.message };
}

export type TripDetail = {
  id: string;
  title: string;
  hostName: string;
  hostSince: string;
  durationLabel: string;
  runsOnDays: number[];
  runDates: string[];
  departsMins: number;
  /** Approximate return time — optional, descriptive only. */
  endsMins: number | null;
  pricePaise: number;
  difficulty: "easy" | "moderate" | "challenging";
  minSeats: number;
  /** Null means uncapped. */
  seatsTotal: number | null;
  summary: string;
  includes: string[];
  bringList: string[];
  meetPoint: string;
  meetAtHotel: boolean;
  mapsUrl: string;
  photoPaths: string[];
};

export async function getOwnTrip(partnerId: string, id: string): Promise<TripDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("trips")
    .select(
      "id, title, host_name, host_since, duration_label, runs_on_days, run_dates, departs_mins, ends_mins, price_paise, difficulty, min_seats, seats_total, summary, includes, bring_list, meet_point, meet_at_hotel, maps_url",
    )
    .eq("id", id)
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    title: data.title,
    hostName: data.host_name,
    hostSince: data.host_since,
    durationLabel: data.duration_label,
    runsOnDays: data.runs_on_days ?? [],
    runDates: data.run_dates ?? [],
    departsMins: data.departs_mins ?? 360,
    endsMins: data.ends_mins,
    pricePaise: data.price_paise,
    difficulty: data.difficulty,
    minSeats: data.min_seats,
    seatsTotal: data.seats_total,
    summary: data.summary,
    includes: data.includes ?? [],
    bringList: data.bring_list ?? [],
    meetPoint: data.meet_point,
    meetAtHotel: data.meet_at_hotel ?? false,
    mapsUrl: data.maps_url ?? "",
    photoPaths: await readListingPhotos("trip", data.id),
  };
}

export async function updatePartnerTrip(
  id: string,
  input: {
    title: string;
    hostName: string;
    hostSince: string;
    durationLabel: string;
    runsOnDays: number[];
    runDates: string[];
    departsMins: number;
    /** Approximate return time — optional, descriptive only. */
    endsMins: number | null;
    pricePaise: number;
    difficulty: "easy" | "moderate" | "challenging";
    minSeats: number;
    /** Null means uncapped. */
    seatsTotal: number | null;
    summary: string;
    includes: string[];
    bringList: string[];
    meetPoint: string;
    meetAtHotel: boolean;
    mapsUrl: string;
    photoPaths: string[];
  },
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_partner_trip", {
    p_id: id,
    p_title: input.title,
    p_host_name: input.hostName,
    p_host_since: input.hostSince,
    p_duration_label: input.durationLabel,
    p_runs_on_days: input.runsOnDays,
    p_price_paise: input.pricePaise,
    p_difficulty: input.difficulty,
    p_min_seats: input.minSeats,
    p_seats_total: input.seatsTotal,
    p_summary: input.summary,
    p_includes: input.includes,
    p_bring_list: input.bringList,
    p_meet_point: input.meetPoint,
    p_photo_path: input.photoPaths[0] ?? null,
    p_departs_mins: input.departsMins,
    p_run_dates: input.runDates,
    p_meet_at_hotel: input.meetAtHotel,
    p_maps_url: input.mapsUrl,
    p_ends_mins: input.endsMins,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  const photos = await setListingPhotos("trip", id, input.photoPaths);
  if (!photos.ok) return photos;

  return { ok: true, message: row.message };
}

export type SailingDetail = {
  id: string;
  fromIsland: string;
  toIsland: string;
  styleLabel: string;
  depMins: number;
  durationMins: number;
  farePaise: number;
  capacity: number;
  daysOfWeek: number[];
  styleTone: BadgeTone;
  info: string;
  infoWarn: boolean;
  photoPaths: string[];
};

export async function getOwnSailing(partnerId: string, id: string): Promise<SailingDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("sailings")
    .select(
      "id, from_island, to_island, style_label, dep_mins, duration_mins, fare_paise, capacity, days_of_week, style_tone, info, info_warn",
    )
    .eq("id", id)
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    fromIsland: data.from_island,
    toIsland: data.to_island,
    styleLabel: data.style_label,
    depMins: data.dep_mins,
    durationMins: data.duration_mins,
    farePaise: data.fare_paise,
    capacity: data.capacity,
    daysOfWeek: data.days_of_week ?? [],
    styleTone: data.style_tone,
    info: data.info ?? "",
    infoWarn: data.info_warn ?? false,
    photoPaths: await readListingPhotos("ferry", data.id),
  };
}

// Route (from/to island) isn't editable here — see 016's own comment for
// why, same reasoning 013 already applied to category/type on the other
// three kinds.
export async function updatePartnerSailing(
  id: string,
  input: {
    styleLabel: string;
    depMins: number;
    durationMins: number;
    farePaise: number;
    capacity: number;
    daysOfWeek: number[];
    styleTone: BadgeTone;
    info: string;
    infoWarn: boolean;
    photoPaths: string[];
  },
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_partner_sailing", {
    p_id: id,
    p_style_label: input.styleLabel,
    p_dep_mins: input.depMins,
    p_duration_mins: input.durationMins,
    p_fare_paise: input.farePaise,
    p_capacity: input.capacity,
    p_days_of_week: input.daysOfWeek,
    p_style_tone: input.styleTone,
    p_info: input.info,
    p_info_warn: input.infoWarn,
    p_photo_path: input.photoPaths[0] ?? null,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  const photos = await setListingPhotos("ferry", id, input.photoPaths);
  if (!photos.ok) return photos;

  return { ok: true, message: row.message };
}

// ---------------------------------------------------------------------------
// Schedules — the timetable behind an activity. See 017-partner-schedule-
// editor.sql: unlike every update_* RPC above, saving a schedule does NOT
// flip is_listed back to pending — hours/capacity are operational, not
// content Andaman Go re-reviews. (A stay's room types get the same
// operational treatment via setStayRoomTypes, further up in this file.)
//
// Reads go straight to the table rather than through an RPC: it already
// carries a "catalogue is public" select policy (016's booking pages need
// it), so there's nothing a get-RPC would add. Ownership is still checked
// before returning anything, the same way getOwnActivity/getOwnStay already
// check partner_id, so one partner can't probe another's activity_id for
// its schedule.
// ---------------------------------------------------------------------------

export type ActivityScheduleSlot = {
  id: string;
  timeMins: number;
  /** Set on a window row (090) — the end of the range, inclusive. Null on a
   *  fixed, exact departure time. */
  endTimeMins: number | null;
  /** Null means uncapped. */
  capacity: number | null;
  daysOfWeek: number[];
  closedReason: string | null;
};

export async function getActivitySchedule(
  partnerId: string,
  activityId: string,
): Promise<ActivityScheduleSlot[] | null> {
  const supabase = await supabaseServer();

  const { data: owner } = await supabase
    .from("activities")
    .select("id")
    .eq("id", activityId)
    .eq("partner_id", partnerId)
    .maybeSingle();
  if (!owner) return null;

  const { data, error } = await supabase
    .from("activity_schedule")
    .select("id, time_mins, end_time_mins, capacity, days_of_week, closed_reason")
    .eq("activity_id", activityId)
    .order("time_mins");
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    timeMins: row.time_mins,
    endTimeMins: row.end_time_mins,
    capacity: row.capacity,
    daysOfWeek: row.days_of_week,
    closedReason: row.closed_reason,
  }));
}

export async function setPartnerActivitySchedule(
  activityId: string,
  slots: {
    timeMins: number;
    endTimeMins: number | null;
    capacity: number | null;
    daysOfWeek: number[];
    closedReason: string | null;
  }[],
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_activity_schedule", {
    p_activity_id: activityId,
    p_slots: slots.map((s) => ({
      time_mins: s.timeMins,
      end_time_mins: s.endTimeMins,
      capacity: s.capacity,
      days_of_week: s.daysOfWeek,
      closed_reason: s.closedReason,
    })),
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

// ---------------------------------------------------------------------------
// Per-listing location — 071/096. A stay or activity can pin its own
// address / Maps link, separate from the business profile's headquarters
// address, so "Directions" on a booking lands on the exact property booked.
// Operational like the schedules above: saving does NOT send the listing back
// to review. An empty string clears the override.
// ---------------------------------------------------------------------------

export async function setPartnerStayLocation(
  stayId: string,
  input: { address: string; mapsUrl: string },
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_stay_location", {
    p_id: stayId,
    p_address: input.address,
    p_maps_url: input.mapsUrl,
  });
  if (error) return stepFailure("set_partner_stay_location", error);
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export async function setPartnerActivityLocation(
  activityId: string,
  input: { area: string; address: string; mapsUrl: string },
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_activity_location", {
    p_id: activityId,
    p_area: input.area,
    p_address: input.address,
    p_maps_url: input.mapsUrl,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}
