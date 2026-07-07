import { createFileRoute } from "@tanstack/react-router";
import { getAdminClient } from "@/lib/supabase-admin";
import { randomToken, json, logEvent } from "@/lib/oauth";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

/** Dynamic Client Registration (RFC 7591) for MCP connectors. */
export const Route = createFileRoute("/api/oauth/register")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const admin = getAdminClient();
        if (!admin) return json({ error: "server_error", error_description: "Admin client not configured" }, 500, CORS);

        let body: {
          redirect_uris?: string[];
          client_name?: string;
          token_endpoint_auth_method?: string;
          grant_types?: string[];
          response_types?: string[];
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid_client_metadata" }, 400, CORS);
        }

        const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
        if (redirect_uris.length === 0) {
          return json({ error: "invalid_redirect_uri", error_description: "redirect_uris required" }, 400, CORS);
        }

        const client_id = `lumi_${randomToken(18)}`;
        const authMethod = body.token_endpoint_auth_method || "none";
        const client_secret = authMethod === "none" ? null : randomToken(24);

        const { error } = await admin.from("oauth_clients").insert({
          client_id,
          client_secret,
          client_name: body.client_name ?? "MCP Client",
          redirect_uris,
        });
        if (error) return json({ error: "server_error", error_description: error.message }, 500, CORS);

        await logEvent({ method: "register", user_agent: request.headers.get("user-agent"), note: `redirects=${redirect_uris.join(",")}` });
        return json(
          {
            client_id,
            ...(client_secret ? { client_secret } : {}),
            client_id_issued_at: Math.floor(Date.now() / 1000),
            redirect_uris,
            client_name: body.client_name ?? "MCP Client",
            token_endpoint_auth_method: authMethod,
            grant_types: body.grant_types ?? ["authorization_code", "refresh_token"],
            response_types: body.response_types ?? ["code"],
          },
          201,
          CORS,
        );
      },
    },
  },
});
