import { getAdminClient } from "./supabase-admin";

/** Public base URL of this deployment (for OAuth issuer + preview links). */
export function serverBaseUrl(req: Request): string {
  const env = process.env.PUBLIC_APP_URL;
  if (env) return env.replace(/\/+$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 of a string, base64url-encoded (for PKCE S256 verification). */
export async function sha256base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

/** Verify a PKCE code_verifier against a stored challenge. */
export async function verifyPkce(
  verifier: string | undefined,
  challenge: string | null | undefined,
  method: string | null | undefined,
): Promise<boolean> {
  if (!challenge) return true; // no PKCE was requested
  if (!verifier) return false;
  if (method === "plain") return verifier === challenge;
  return (await sha256base64url(verifier)) === challenge;
}

export function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export type TokenRow = { access_token: string; user_id: string; scope: string | null; expires_at: string };

/** Resolve a Bearer access token to its user id (or null if invalid/expired). */
export async function resolveAccessToken(token: string): Promise<TokenRow | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from("oauth_tokens")
    .select("access_token, user_id, scope, expires_at")
    .eq("access_token", token)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as TokenRow;
}

/** Best-effort debug log to public.mcp_debug (never throws, no secrets). */
export async function logEvent(row: {
  method?: string;
  accept?: string;
  has_auth?: boolean;
  auth_valid?: boolean;
  protocol_version?: string | null;
  session_id?: string | null;
  user_agent?: string | null;
  note?: string;
}) {
  try {
    const admin = getAdminClient();
    if (!admin) return;
    await admin.from("mcp_debug").insert(row);
  } catch {
    /* ignore */
  }
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}
