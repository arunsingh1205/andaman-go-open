-- ===========================================================================
-- Migration 045 — addresses for the demo partners
--
-- "Getting there" on the booking confirmation (and the Directions button in My
-- Bookings) only appears once a partner has given an address or a Maps link. A
-- real partner types that in onboarding; the seed businesses never had one, so
-- the feature was invisible on demo data.
--
-- This backfills a plausible address for every demo partner that is somewhere
-- you actually go. Keyed by slug and written as UPDATE … WHERE address IS NULL,
-- so it never clobbers an address a real partner has since set, and it is safe
-- to run more than once. Ferries are left alone — you go to a jetty, not the
-- operator's office, and the booking screen skips directions for them anyway.
-- ===========================================================================

update partners p
set address = v.address
from (values
  ('blue-coral-divers',     'Beach No. 3, Govind Nagar, Havelock Island, Andaman'),
  ('andaman-sea-walkers',   'Jetty Road, Govind Nagar, Havelock Island, Andaman'),
  ('reef-riders',           'Beach No. 5, Vijaynagar, Havelock Island, Andaman'),
  ('wave-runners',          'Elephant Beach jetty point, Havelock Island, Andaman'),
  ('full-moon-cafe',        'Beach No. 5, Vijaynagar, Havelock Island, Andaman'),
  ('anju-coco-resto',       'Beach No. 3 Main Road, Govind Nagar, Havelock Island, Andaman'),
  ('something-different',   'Kalapathar Road, Havelock Island, Andaman'),
  ('cafe-del-mar',          'Beach No. 3, Govind Nagar, Havelock Island, Andaman'),
  ('golden-spoon',          'Main Market, Govind Nagar, Havelock Island, Andaman'),
  ('beach-road-rentals',    'Jetty Road, Govind Nagar, Havelock Island, Andaman'),
  ('island-wheels',         'Main Market, Govind Nagar, Havelock Island, Andaman'),
  ('govind-scooters',       'Beach No. 3 Road, Govind Nagar, Havelock Island, Andaman'),
  ('sunset-point',          'Radhanagar Road, Havelock Island, Andaman'),
  ('blue-lagoon-shack',     'Beach No. 5, Vijaynagar, Havelock Island, Andaman'),
  ('open-sand',             'Kalapathar Beach, Havelock Island, Andaman'),
  ('anchor-bar',            'Govind Nagar, Havelock Island, Andaman'),
  ('radhanagar-beach',      'Radhanagar Beach (Beach No. 7), Havelock Island, Andaman'),
  ('ravi-k',                'Laxmanpur, Neil Island, Andaman'),
  ('meera-s',               'Vijaynagar, Havelock Island, Andaman'),
  ('anil-d',                'Aberdeen Bazaar, Port Blair, Andaman'),
  ('fatima-b',              'Nilambur Jetty Road, Baratang Island, Andaman'),
  ('sea-view-resort',       'Beach No. 5, Vijaynagar, Havelock Island, Andaman'),
  ('coral-homestay',        'Govind Nagar, Havelock Island, Andaman'),
  ('island-inn',            'Main Market, Govind Nagar, Havelock Island, Andaman'),
  ('barefoot-beach-resort', 'Radhanagar Road, Beach No. 7, Havelock Island, Andaman'),
  ('sunset-shack-homestay', 'Kalapathar Road, Havelock Island, Andaman')
) as v(slug, address)
where p.slug = v.slug
  and coalesce(trim(p.address), '') = '';

-- Check: every non-ferry partner now has somewhere to send a traveller.
select kind, count(*) filter (where address is not null) as with_address, count(*) as total
from partners
group by kind
order by kind;
