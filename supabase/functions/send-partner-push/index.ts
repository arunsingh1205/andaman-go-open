// Send-side of partner push notifications. Everything up to this file only
// wrote rows: notify_partner_of_booking() (020) inserts into
// partner_notifications, native-bridge.tsx registers a device's FCM token
// into partner_push_tokens (094). Nothing actually pushed. This is that last
// step — a Supabase Database Webhook (configured in the dashboard, not in
// SQL) fires this function on every insert into partner_notifications, and
// it calls Firebase's FCM HTTP v1 API for each of that partner's devices.
//
// Deploy: `supabase functions deploy send-partner-push`
// Secrets it needs (`supabase secrets set NAME=value`, or via the dashboard):
//   FIREBASE_PROJECT_ID     — from the Firebase service-account JSON: "project_id"
//   FIREBASE_CLIENT_EMAIL   — "client_email"
//   FIREBASE_PRIVATE_KEY    — "private_key" (keep the \n escapes; Deno.env
//                             gives it back as one string with literal \n,
//                             which pemToCryptoKey() below unescapes)
//   PARTNER_PUSH_WEBHOOK_SECRET — any random string you also put in the
//                             webhook's custom header (see below) so this
//                             function only acts on requests that actually
//                             came from Supabase, not the open internet.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already present in every
// Edge Function's environment automatically — no need to set those.
//
// Wiring the trigger (dashboard, not SQL — Database Webhooks aren't schema,
// so 020's migration deliberately doesn't create one): Database → Webhooks →
// Create a new hook → table partner_notifications → Insert → HTTP request to
// this function's URL → add header "x-webhook-secret" set to the same value
// as PARTNER_PUSH_WEBHOOK_SECRET above.

import { createClient } from "jsr:@supabase/supabase-js@2";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type NotificationRow = {
  id: string;
  partner_id: string;
  kind: string;
  title: string;
  body: string;
  item_id: string | null;
};

type WebhookPayload = {
  type: string;
  table: string;
  record: NotificationRow;
};

// The service-account private key arrives as PEM text (BEGIN/END markers,
// base64 body). Web Crypto wants the raw base64 as a PKCS8 key, not the PEM
// wrapper.
async function pemToCryptoKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Google's JWT-bearer flow: a self-signed JWT (service account -> Google),
// exchanged for a short-lived OAuth access token that's the actual bearer
// token FCM's send API wants. No refresh token, no user consent — a service
// account signs for itself.
async function getAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const privateKeyPem = Deno.env.get("FIREBASE_PRIVATE_KEY");
  if (!clientEmail || !privateKeyPem) {
    throw new Error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY not set");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;

  const key = await pemToCryptoKey(privateKeyPem);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token as string;
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("PARTNER_PUSH_WEBHOOK_SECRET");
  if (expectedSecret && req.headers.get("x-webhook-secret") !== expectedSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  const payload = (await req.json()) as WebhookPayload;
  if (payload.table !== "partner_notifications" || payload.type !== "INSERT") {
    return new Response("ignored", { status: 200 });
  }
  const notification = payload.record;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    // Service role — this runs outside any partner's session, same reason
    // the Postgres trigger that wrote this row runs SECURITY DEFINER.
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tokens, error } = await supabase
    .from("partner_push_tokens")
    .select("token")
    .eq("partner_id", notification.partner_id);

  if (error) return new Response(`token lookup failed: ${error.message}`, { status: 500 });
  if (!tokens || tokens.length === 0) return new Response("no devices", { status: 200 });

  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  if (!projectId) return new Response("FIREBASE_PROJECT_ID not set", { status: 500 });

  const accessToken = await getAccessToken();
  const staleTokens: string[] = [];

  await Promise.all(
    tokens.map(async ({ token }) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: notification.title, body: notification.body },
            // Read by pushNotificationActionPerformed in native-bridge.tsx to
            // deep-link the same way the in-app Notifications screen does.
            data: { kind: notification.kind, itemId: notification.item_id ?? "" },
            android: { priority: "high" },
          },
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        // UNREGISTERED / NOT_FOUND means the app was uninstalled or the
        // token rotated — that row is dead weight, not a retryable failure.
        if (detail.includes("UNREGISTERED") || detail.includes("NOT_FOUND")) {
          staleTokens.push(token);
        } else {
          console.error(`FCM send failed for one device: ${res.status} ${detail}`);
        }
      }
    }),
  );

  if (staleTokens.length > 0) {
    await supabase.from("partner_push_tokens").delete().in("token", staleTokens);
  }

  return new Response("ok", { status: 200 });
});
