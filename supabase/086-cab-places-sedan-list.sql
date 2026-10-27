-- ===========================================================================
-- Migration 086 — places named on the official Sedan price list
--
-- Arun supplied a full official Sedan (AC) rate card — the first list this
-- app has had straight from the union rather than researched/estimated.
-- Ahead of seeding it as a genuine second vehicle tier (087), this adds the
-- named hotels/resorts/spots it references that aren't places yet.
--
-- Safe to run more than once.
-- ===========================================================================

insert into cab_places (island_slug, label, aliases, is_airport, sort_order) values
  -- Port Blair
  ('port-blair', 'Rainforest Cottages',            '{rainforest cottages,rainforest}', false, 44),
  ('port-blair', 'Clarks Exotica Island House',    '{clarks exotica,clarks}', false, 45),
  ('port-blair', 'Sinclairs Bayview',              '{sinclairs,sinclairs bayview}', false, 46),
  ('port-blair', 'ITC Hotel Bay Island',           '{itc,itc hotel,bay island,welcomhotel}', false, 47),
  ('port-blair', 'Flag Point',                     '{flag point,flagpoint}', false, 48),
  ('port-blair', 'Joggers Park',                   '{joggers park,jogging park}', false, 49),
  -- Havelock
  ('havelock',   'Taj Exotica Resort',             '{taj,taj exotica,hotel taj}', false, 9),
  ('havelock',   'TSG Blue Resort',                '{tsg blue,tsg blue resort}', false, 10),
  ('havelock',   'Barefoot at Havelock',           '{barefoot,barefoot resort}', false, 11),
  ('havelock',   'Silver Sand Beach Resort',       '{silver sand,silver sand havelock}', false, 12),
  ('havelock',   'Sandyy Wavess Beach Resort',     '{sandyy wavess,sandy waves}', false, 13),
  ('havelock',   'Silver Sand Village Resort',     '{silver sand village}', false, 14),
  ('havelock',   'Hotel Jalakara',                 '{jalakara,hotel jalakara}', false, 15),
  ('havelock',   'Hotel De Fort',                  '{de fort,hotel de fort}', false, 16),
  ('havelock',   'Hotel Sea Hills',                '{sea hills,hotel sea hills}', false, 17),
  ('havelock',   'Dolphin Beach Resort',           '{dolphin beach,dolphin resort}', false, 18),
  -- Neil
  ('neil',       'TSG Aura Resort',                '{tsg aura,hotel tsg aura}', false, 5),
  ('neil',       'Summer Sand Beach Resort',       '{summer sand}', false, 6),
  ('neil',       'Aquays Resort',                  '{aquays,aquay,aquay''s}', false, 7),
  ('neil',       'Natural Bridge (Howdah Bridge)', '{natural bridge,howdah bridge,natural rock formation}', false, 8)
on conflict (island_slug, label) do nothing;


select 'sedan list places ready' as done,
  (select count(*) from cab_places) as places;
