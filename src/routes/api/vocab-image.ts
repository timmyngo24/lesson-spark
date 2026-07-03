import { createFileRoute } from "@tanstack/react-router";

const BASE = "https://api.coachio.ai/api/v1";

export const Route = createFileRoute("/api/vocab-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.COACHIO_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "COACHIO_API_KEY missing" },
            { status: 500 },
          );
        }

        let body: { word?: string; definition?: string; example?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const word = (body.word ?? "").trim();
        if (!word) {
          return Response.json({ error: "Missing word" }, { status: 400 });
        }

        const prompt =
          `A friendly, minimal pastel illustration representing the English word "${word}"` +
          (body.definition ? ` — meaning: ${body.definition}` : "") +
          (body.example ? `. Context: "${body.example}"` : "") +
          `. Soft pastel colors (pink, mint, lavender, sky), rounded shapes, ` +
          `flat modern vector style, centered subject on a clean light background, ` +
          `cheerful and clear so an ESL learner instantly recognizes the concept. ` +
          `No text, no letters, no watermark.`;

        // Submit task
        const submitRes = await fetch(`${BASE}/task/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({
            task_type: "image",
            prompt,
            ai_model_config: {
              model_identifier: "gpt_image_2",
              generation_mode: "default",
              aspect_ratio: "1:1",
              resolution: "1k",
            },
          }),
        });

        if (!submitRes.ok) {
          const detail = await submitRes.text().catch(() => "");
          return Response.json(
            { error: `Coachio submit ${submitRes.status}`, detail: detail.slice(0, 400) },
            { status: submitRes.status },
          );
        }
        const submitted = (await submitRes.json()) as { task_id?: string };
        const taskId = submitted.task_id;
        if (!taskId) {
          return Response.json({ error: "No task_id returned" }, { status: 502 });
        }

        // Poll (max ~90s with backoff)
        const started = Date.now();
        const maxMs = 90_000;
        let wait = 2000;
        while (Date.now() - started < maxMs) {
          await new Promise((r) => setTimeout(r, wait));
          const stRes = await fetch(`${BASE}/task/status/${taskId}`, {
            headers: { "X-API-Key": apiKey },
          });
          if (!stRes.ok) {
            const detail = await stRes.text().catch(() => "");
            return Response.json(
              { error: `Coachio status ${stRes.status}`, detail: detail.slice(0, 400) },
              { status: stRes.status },
            );
          }
          const st = (await stRes.json()) as {
            status?: string;
            result_urls?: string[];
            result?: { output_urls?: string[] };
            message?: string;
          };
          if (st.status === "completed") {
            const urls = st.result_urls ?? st.result?.output_urls ?? [];
            if (!urls.length) {
              return Response.json(
                { error: "Completed with no URLs", detail: JSON.stringify(st).slice(0, 400) },
                { status: 502 },
              );
            }
            return Response.json({ url: urls[0], taskId });
          }
          if (st.status === "failed") {
            return Response.json(
              { error: st.message || "Task failed" },
              { status: 502 },
            );
          }
          wait = Math.min(wait + 500, 4000);
        }
        return Response.json({ error: "Timed out generating image" }, { status: 504 });
      },
    },
  },
});
