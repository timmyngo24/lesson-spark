import { createFileRoute } from "@tanstack/react-router";
import { getAdminClient } from "@/lib/supabase-admin";
import { getBearer, randomToken, json, logEvent } from "@/lib/oauth";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

/**
 * Consent step: the /authorize page calls this after the signed-in user approves.
 * The user's Supabase access token (Bearer) proves who they are; we mint an
 * authorization code bound to that user + client and return the redirect URL.
 */
export const Route = createFileRoute("/api/oauth/authorize")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const admin = getAdminClient();
        if (!admin) return json({ error: "server_error" }, 500, CORS);

        const jwt = getBearer(request);
        if (!jwt) return json({ error: "login_required" }, 401, CORS);
        const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
        if (userErr || !userData.user) return json({ error: "login_required" }, 401, CORS);

        let body: {
          client_id?: string;
          redirect_uri?: string;
          code_challenge?: string;
          code_challenge_method?: string;
          scope?: string;
          state?: string;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid_request" }, 400, CORS);
        }

        const { client_id, redirect_uri, code_challenge, code_challenge_method, scope, state } = body;
        if (!client_id || !redirect_uri) return json({ error: "invalid_request" }, 400, CORS);

        const { data: client } = await admin
          .from("oauth_clients")
          .select("client_id, redirect_uris")
          .eq("client_id", client_id)
          .maybeSingle();
        if (!client) return json({ error: "invalid_client" }, 400, CORS);
        if (!(client.redirect_uris as string[]).includes(redirect_uri)) {
          return json({ error: "invalid_redirect_uri" }, 400, CORS);
        }

        const code = randomToken(24);
        const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const { error } = await admin.from("oauth_codes").insert({
          code,
          client_id,
          user_id: userData.user.id,
          redirect_uri,
          code_challenge: code_challenge ?? null,
          code_challenge_method: code_challenge_method ?? null,
          scope: scope ?? "lumi.read lumi.write",
          expires_at,
        });
        if (error) return json({ error: "server_error", error_description: error.message }, 500, CORS);

        await logEvent({ method: "authorize:code_minted", auth_valid: true, note: `client=${client_id} redirect=${redirect_uri}` });
        const url = new URL(redirect_uri);
        url.searchParams.set("code", code);
        if (state) url.searchParams.set("state", state);
        return json({ redirect: url.toString() }, 200, CORS);
      },
    },
  },
});
