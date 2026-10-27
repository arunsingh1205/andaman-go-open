// Parsing the credential a partner's own system presents to
// app/api/partner/v1/**. The bearer token IS the API key's raw secret — this
// only ever computes its SHA-256 hash (matching lib/partner-api-keys.ts's
// createMyApiKey) and reads its own prefix back out of it. The actual check
// — does this (prefix, hash) pair match a live key — happens inside the
// database, in api_push_stay_availability / api_list_partner_bookings (099);
// this file never touches Postgres itself.

import crypto from "crypto";

export type ParsedApiKey = { prefix: string; hash: string };

export function parseApiKey(authHeader: string | null): ParsedApiKey | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  const secret = match?.[1];
  if (!secret || secret.length < 16) return null;

  return {
    prefix: secret.slice(0, 16),
    hash: crypto.createHash("sha256").update(secret).digest("hex"),
  };
}
