// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Longer function timeouts on Vercel for the slow AI endpoints (ignored on
// other presets). Lesson generation + image polling exceed the 10s default.
// Note: durations > 10s require a Vercel Pro plan. `vercel` is a valid nitro
// option applied at runtime; the wrapper's type is narrower, so we widen here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nitro: any = {
  vercel: {
    functionRules: {
      "/mcp": { maxDuration: "max" },
      "/api/lesson": { maxDuration: "max" },
      "/api/vocab-image": { maxDuration: "max" },
    },
  },
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro,
});
