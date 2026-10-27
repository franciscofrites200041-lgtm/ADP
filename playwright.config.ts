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
  webServer: {
    command: "pnpm --filter @middleware/web dev",
    port: 3000,
    reuseExistingServer: !environment.CI,
  },
});
