import { defineConfig } from "@playwright/test";
import { z } from "zod";

const environment = z
  .object({
    CI: z.stringbool().optional().default(false),
  })
  .parse(process.env);

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
  },
  // The browser suite needs both processes. It used to start only the web app
  // with `next dev`, which never ran the API and — on this machine at least —
  // does not hydrate, so the suite could not have passed anywhere.
  webServer: [
    {
      command: "pnpm --filter @middleware/api dev",
      port: 3001,
      reuseExistingServer: !environment.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @middleware/web exec next start -p 3000",
      port: 3000,
      reuseExistingServer: !environment.CI,
      timeout: 120_000,
    },
  ],
});
