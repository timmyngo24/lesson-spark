import { createFileRoute } from "@tanstack/react-router";

const COACHIO_URL = "https://api.coachio.ai/api/v1/llm/chat/completions";
const MODEL = "google/gemini-3.1-flash-lite";

const SYSTEM_PROMPT = `You are an expert ESL curriculum designer. Given a source document/topic, produce a complete gamified English lesson for beginner-to-intermediate learners.

Return STRICT JSON only (no markdown fences, no prose) with this exact shape:
{
  "title": string,                       // Lesson title in English
  "topic": string,                       // Short topic descriptor
  "level": "Beginner" | "Elementary" | "Intermediate",
  "intro": string,                       // 1-2 sentence friendly intro
  "vocabulary": [
    {
      "word": string,
      "pos": string,                     // part of speech: noun/verb/adj...
      "definition": string,              // simple learner-friendly definition
      "emoji": string,                   // single emoji illustration
      "pronunciation": string,           // IPA if possible, else phonetic
      "example": string                  // natural example sentence using the word
    }
  ],                                     // 8-10 items
  "trueFalse": [
    { "statement": string, "answer": boolean, "explain": string }
  ],                                     // 5 items, based on the document
  "fillBlank": {
    "dialogue": [
      { "speaker": string, "line": string, "blank": string | null }
    ],                                   // 6-8 lines; when blank!=null, the line contains "____"
    "options": string[]                  // pool of options mixing correct + distractors
  },
  "quiz": [
    {
      "question": string,
      "choices": string[],               // exactly 4
      "answerIndex": number,             // 0-3
      "explain": string
    }
  ],                                     // 5 items
  "matching": [
    { "left": string, "right": string }
  ],                                     // 6 pairs (word -> definition/synonym/translation of it)
  "wheelPrompts": string[]               // 8 speaking/writing prompts to spin the wheel
}

Rules:
- All content in English, tuned for ESL learners.
- Vocabulary MUST be drawn from or clearly relevant to the provided source.
- Keep sentences short and clear.
- Never wrap the JSON in code fences. Output ONLY the JSON object.`;

export const Route = createFileRoute("/api/lesson")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.COACHIO_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "COACHIO_API_KEY missing" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        let body: { source?: string };
        try {
          body = (await request.json()) as { source?: string };
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const source = (body.source ?? "").trim();
        if (!source) {
          return new Response(
            JSON.stringify({ error: "Missing 'source' text" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        // Trim overly large inputs to keep the request healthy.
        const trimmed = source.length > 12000 ? source.slice(0, 12000) : source;

        const upstream = await fetch(COACHIO_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({
            model: MODEL,
            stream: false,
            temperature: 0.6,
            max_tokens: 4096,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: `Build the lesson from this source content:\n\n"""\n${trimmed}\n"""`,
              },
            ],
          }),
        });

        if (!upstream.ok) {
          const text = await upstream.text().catch(() => "");
          return new Response(
            JSON.stringify({
              error: `Coachio ${upstream.status}`,
              detail: text.slice(0, 500),
            }),
            {
              status: upstream.status,
              headers: { "content-type": "application/json" },
            },
          );
        }

        const data = (await upstream.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: unknown;
        };
        const content = data.choices?.[0]?.message?.content ?? "";

        // Robust JSON extraction (strip optional code fences).
        const cleaned = content
          .replace(/^```(?:json)?/i, "")
          .replace(/```$/i, "")
          .trim();
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        const jsonStr =
          firstBrace >= 0 && lastBrace > firstBrace
            ? cleaned.slice(firstBrace, lastBrace + 1)
            : cleaned;

        let lesson: unknown;
        try {
          lesson = JSON.parse(jsonStr);
        } catch {
          return new Response(
            JSON.stringify({
              error: "Model did not return valid JSON",
              raw: content.slice(0, 800),
            }),
            {
              status: 502,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return Response.json({ lesson, usage: data.usage ?? null });
      },
    },
  },
});
