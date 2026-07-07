import { createFileRoute } from "@tanstack/react-router";
import { getAdminClient } from "@/lib/supabase-admin";
import { getBearer, resolveAccessToken, serverBaseUrl } from "@/lib/oauth";
import { generateLesson } from "@/lib/coachio";
import type { Lesson } from "@/lib/lesson-types";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version, mcp-session-id, accept",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "lumi", title: "Lumi ESL", version: "1.0.0" };

const TOOLS = [
  {
    name: "create_lesson",
    description: "Generate a new gamified English lesson from a topic or source text and save it to the user's Lumi account. Returns the lesson id and a private preview link.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "A topic, paragraph, or article to build the lesson from." },
        make_public: { type: "boolean", description: "If true, the preview link is shareable publicly. Default false." },
      },
      required: ["source"],
    },
  },
  {
    name: "list_lessons",
    description: "List the user's saved Lumi lessons (most recent first).",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "Max lessons to return (default 20)." } } },
  },
  {
    name: "get_lesson",
    description: "Get the full content of one of the user's lessons by id.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "get_preview_link",
    description: "Get a shareable preview link for a lesson. Optionally make it public.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, make_public: { type: "boolean" } },
      required: ["id"],
    },
  },
];

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: { ...CORS, "access-control-allow-headers": "content-type, authorization, mcp-protocol-version, mcp-session-id, accept" },
        }),
      // Stateless server: we don't offer a server→client SSE stream, so GET is
      // 405 (spec-allowed). All request/response happens over POST as JSON.
      GET: async () => new Response("Method Not Allowed", { status: 405, headers: { ...CORS, allow: "POST" } }),
      POST: async ({ request }) => {
        const base = serverBaseUrl(request);
        const wwwAuth = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`;
        const accept = request.headers.get("accept") || "";
        const wantsSse = accept.includes("text/event-stream");

        const bodyText = await request.text();
        let payload: unknown = null;
        try { payload = JSON.parse(bodyText); } catch { /* logged below */ }
        const method = !Array.isArray(payload) && payload ? (payload as JsonRpcRequest).method : "(batch/parse-error)";

        const token = getBearer(request);
        const auth = token ? await resolveAccessToken(token) : null;

        // Best-effort debug log (no secrets).
        await logMcp({
          method,
          accept,
          has_auth: !!token,
          auth_valid: !!auth,
          protocol_version: request.headers.get("mcp-protocol-version"),
          session_id: request.headers.get("mcp-session-id"),
          user_agent: request.headers.get("user-agent"),
        });

        if (!auth) {
          return new Response(JSON.stringify({ error: "invalid_token" }), {
            status: 401,
            headers: { ...CORS, "content-type": "application/json", "www-authenticate": wwwAuth },
          });
        }

        if (payload == null) {
          return rpcError(null, -32700, "Parse error", wantsSse);
        }

        // JSON-RPC batch support (arrays).
        if (Array.isArray(payload)) {
          const responses = [];
          for (const m of payload as JsonRpcRequest[]) {
            if (m && m.id !== undefined && m.id !== null) {
              responses.push(await handleOne(m, auth.user_id, base));
            }
          }
          if (responses.length === 0) return new Response(null, { status: 202, headers: CORS });
          return encode(responses, wantsSse);
        }

        const msg = payload as JsonRpcRequest;
        // Notifications (no id) get an empty 202.
        if (!msg || msg.id === undefined || msg.id === null) {
          return new Response(null, { status: 202, headers: CORS });
        }
        return encode(await handleOne(msg, auth.user_id, base), wantsSse, msg.method === "initialize");
      },
    },
  },
});

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

/** Run one request and wrap it as a JSON-RPC response object (never throws). */
async function handleOne(msg: JsonRpcRequest, userId: string, base: string) {
  try {
    const result = await handle(msg, userId, base);
    if (msg.method === "tools/list") {
      const n = (result as { tools?: unknown[] }).tools?.length ?? 0;
      await logMcp({ method: "tools/list:resp", accept: "", has_auth: true, auth_valid: true, protocol_version: null, session_id: null, user_agent: `count=${n}` });
    }
    return { jsonrpc: "2.0" as const, id: msg.id ?? null, result };
  } catch (e) {
    return { jsonrpc: "2.0" as const, id: msg.id ?? null, error: { code: -32603, message: e instanceof Error ? e.message : "Internal error" } };
  }
}

async function handle(msg: JsonRpcRequest, userId: string, base: string): Promise<unknown> {
  switch (msg.method) {
    case "initialize": {
      // Echo the client's protocol version when it's one we know; else ours.
      const requested = String((msg.params as Record<string, unknown> | undefined)?.protocolVersion ?? "");
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION;
      return {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: "Lumi turns any topic into a gamified English lesson. Use create_lesson to make one, get_preview_link to share it.",
      };
    }
    case "tools/list":
      return { tools: TOOLS };
    case "ping":
      return {};
    case "tools/call":
      return callTool(
        String(msg.params?.name ?? ""),
        (msg.params?.arguments as Record<string, unknown>) ?? {},
        userId,
        base,
      );
    default:
      throw new Error(`Method not found: ${msg.method}`);
  }
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function callTool(name: string, args: Record<string, unknown>, userId: string, base: string) {
  const admin = getAdminClient();
  if (!admin) return textResult("Server not configured (missing service role key).", true);
  const previewUrl = (id: string) => `${base}/p/${id}`;

  switch (name) {
    case "create_lesson": {
      const source = String(args.source ?? "").trim();
      if (!source) return textResult("Missing 'source'.", true);
      const apiKey = process.env.COACHIO_API_KEY;
      if (!apiKey) return textResult("Server COACHIO_API_KEY not set — cannot generate lessons via MCP.", true);

      let lesson: Lesson;
      try {
        lesson = await generateLesson(source, apiKey);
      } catch (e) {
        return textResult(`Generation failed: ${e instanceof Error ? e.message : "unknown"}`, true);
      }
      const visibility = args.make_public === true ? "public" : "private";
      const { data, error } = await admin
        .from("lessons")
        .insert({
          user_id: userId,
          title: lesson.title || "Untitled lesson",
          topic: lesson.topic ?? null,
          level: lesson.level ?? null,
          source: source.slice(0, 4000),
          data: lesson,
          visibility,
        })
        .select("id")
        .single();
      if (error) return textResult(`Save failed: ${error.message}`, true);
      const id = (data as { id: string }).id;
      return textResult(
        JSON.stringify({ id, title: lesson.title, level: lesson.level, words: lesson.vocabulary.length, visibility, preview: previewUrl(id) }, null, 2),
      );
    }

    case "list_lessons": {
      const limit = Math.min(Number(args.limit ?? 20) || 20, 100);
      const { data, error } = await admin
        .from("lessons")
        .select("id, title, level, visibility, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return textResult(`Query failed: ${error.message}`, true);
      return textResult(JSON.stringify(data ?? [], null, 2));
    }

    case "get_lesson": {
      const id = String(args.id ?? "");
      if (!id) return textResult("Missing 'id'.", true);
      const { data, error } = await admin
        .from("lessons")
        .select("id, title, level, visibility, data, created_at")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return textResult(`Query failed: ${error.message}`, true);
      if (!data) return textResult("Lesson not found.", true);
      return textResult(JSON.stringify(data, null, 2));
    }

    case "get_preview_link": {
      const id = String(args.id ?? "");
      if (!id) return textResult("Missing 'id'.", true);
      const { data: owned } = await admin
        .from("lessons")
        .select("id")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!owned) return textResult("Lesson not found.", true);
      if (args.make_public === true) {
        const { error } = await admin.from("lessons").update({ visibility: "public" }).eq("id", id).eq("user_id", userId);
        if (error) return textResult(`Update failed: ${error.message}`, true);
      }
      return textResult(JSON.stringify({ id, preview: previewUrl(id), public: args.make_public === true }, null, 2));
    }

    default:
      return textResult(`Unknown tool: ${name}`, true);
  }
}

/** Encode a JSON-RPC response. Always application/json (spec-valid, and unlike
 *  SSE it's delivered reliably by Vercel serverless). Fully stateless: we never
 *  issue an Mcp-Session-Id, which is the correct model for serverless where
 *  per-session state can't be kept across invocations. */
function encode(body: unknown, _wantsSse: boolean, _isInit = false): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function rpcError(id: string | number | null, code: number, message: string, wantsSse = false) {
  return encode({ jsonrpc: "2.0", id, error: { code, message } }, wantsSse);
}

async function logMcp(fields: {
  method: string;
  accept: string;
  has_auth: boolean;
  auth_valid: boolean;
  protocol_version: string | null;
  session_id: string | null;
  user_agent: string | null;
}) {
  try {
    const admin = getAdminClient();
    if (!admin) return;
    await admin.from("mcp_debug").insert(fields);
  } catch {
    /* never let logging break the request */
  }
}
