// A padded bounding box around Andaman & Nicobar Islands — from Landfall
// Island in the north (~13.7°N) to Indira Point, Great Nicobar in the south
// (~6.75°N), and the open water either side. This is deliberately loose: the
// goal is a friendly "you're outside our service area" notice, not a precise
// coastline check, so the sea between islands (ferries) still counts as in.
const MIN_LAT = 6.5;
const MAX_LAT = 13.9;
const MIN_LNG = 92.0;
const MAX_LNG = 94.0;

export function isWithinAndamanNicobar(lat: number, lng: number): boolean {
  return lat >= MIN_LAT && lat <= MAX_LAT && lng >= MIN_LNG && lng <= MAX_LNG;
}
