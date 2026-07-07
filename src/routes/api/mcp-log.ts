import { createFileRoute } from "@tanstack/react-router";
import { getAdminClient } from "@/lib/supabase-admin";
import { json } from "@/lib/oauth";

// Simple gate — the log contains only request metadata (no secrets), but we
// keep it behind a key so it isn't publicly indexable.
const DEBUG_KEY = "lumidebug";

/** GET /api/mcp-log?key=lumidebug — recent /mcp requests (debugging). */
export const Route = createFileRoute("/api/mcp-log")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("key") !== DEBUG_KEY) {
          return json({ error: "forbidden" }, 403);
        }
        const admin = getAdminClient();
        if (!admin) return json({ error: "admin not configured" }, 500);
        const { data, error } = await admin
          .from("mcp_debug")
          .select("ts, method, accept, has_auth, auth_valid, protocol_version, session_id, user_agent, note")
          .order("ts", { ascending: false })
          .limit(80);
        if (error) {
          if (error.message.includes("mcp_debug")) {
            return json({
              error: "table_missing",
              hint: "Run the CREATE TABLE public.mcp_debug snippet in Supabase SQL Editor, then retry.",
            });
          }
          return json({ error: error.message }, 500);
        }
        return json({ count: data?.length ?? 0, rows: data ?? [] });
      },
    },
  },
});
