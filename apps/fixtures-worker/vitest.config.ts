import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The Workers project cannot live in the root vitest.config.ts: it needs the
// workerd runtime, which @cloudflare/vitest-pool-workers installs as a Vite
// plugin reading this directory's Wrangler config.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    name: "workers",
    include: ["test/**/*.test.ts"],
  },
});
