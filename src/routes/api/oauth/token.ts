import { createFileRoute } from "@tanstack/react-router";
import { getAdminClient } from "@/lib/supabase-admin";
import { randomToken, verifyPkce, json, logEvent } from "@/lib/oauth";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

const ACCESS_TTL = 60 * 60; // 1 hour

async function parseBody(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await request.json()) as Record<string, string>;
  }
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

/** OAuth 2.1 token endpoint: authorization_code + refresh_token grants. */
export const Route = createFileRoute("/api/oauth/token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const admin = getAdminClient();
        if (!admin) return json({ error: "server_error" }, 500, CORS);

        const body = await parseBody(request).catch(() => ({}) as Record<string, string>);
        const grant = body.grant_type;
        await logEvent({
          method: `token:${grant ?? "?"}`,
          user_agent: request.headers.get("user-agent"),
          note: `has_code=${!!body.code} has_verifier=${!!body.code_verifier} client=${body.client_id ?? "?"}`,
        });

        if (grant === "authorization_code") {
          const { code, redirect_uri, client_id, code_verifier } = body;
          if (!code || !client_id) return json({ error: "invalid_request" }, 400, CORS);

          const { data: row } = await admin
            .from("oauth_codes")
            .select("*")
            .eq("code", code)
            .maybeSingle();
          if (!row) return json({ error: "invalid_grant" }, 400, CORS);
          if (row.client_id !== client_id) return json({ error: "invalid_grant" }, 400, CORS);
          if (row.redirect_uri && redirect_uri && row.redirect_uri !== redirect_uri) {
            return json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400, CORS);
          }
          if (new Date(row.expires_at).getTime() < Date.now()) {
            await admin.from("oauth_codes").delete().eq("code", code);
            return json({ error: "invalid_grant", error_description: "code expired" }, 400, CORS);
          }
          const pkceOk = await verifyPkce(code_verifier, row.code_challenge, row.code_challenge_method);
          if (!pkceOk) return json({ error: "invalid_grant", error_description: "PKCE failed" }, 400, CORS);

          // One-time use.
          await admin.from("oauth_codes").delete().eq("code", code);
          return issueToken(admin, client_id, row.user_id, row.scope);
        }

        if (grant === "refresh_token") {
          const { refresh_token, client_id } = body;
          if (!refresh_token) return json({ error: "invalid_request" }, 400, CORS);
          const { data: row } = await admin
            .from("oauth_tokens")
            .select("*")
            .eq("refresh_token", refresh_token)
            .maybeSingle();
          if (!row) return json({ error: "invalid_grant" }, 400, CORS);
          // Rotate: delete old, issue new.
          await admin.from("oauth_tokens").delete().eq("refresh_token", refresh_token);
          return issueToken(admin, client_id || row.client_id, row.user_id, row.scope);
        }

        return json({ error: "unsupported_grant_type" }, 400, CORS);
      },
    },
  },
});

async function issueToken(
  admin: NonNullable<ReturnType<typeof getAdminClient>>,
  client_id: string,
  user_id: string,
  scope: string | null,
) {
  const access_token = randomToken(32);
  const refresh_token = randomToken(32);
  const expires_at = new Date(Date.now() + ACCESS_TTL * 1000).toISOString();
  const { error } = await admin.from("oauth_tokens").insert({
    access_token,
    refresh_token,
    client_id,
    user_id,
    scope,
    expires_at,
  });
  if (error) return json({ error: "server_error", error_description: error.message }, 500, CORS);
  await logEvent({ method: "token:issued", auth_valid: true, note: `client=${client_id}` });
  return json(
    {
      access_token,
      token_type: "Bearer",
      expires_in: ACCESS_TTL,
      refresh_token,
      scope: scope ?? "lumi.read lumi.write",
    },
    200,
    CORS,
  );
}
