import { defineConfig } from "drizzle-kit";
import { z } from "zod";

/**
 * DATABASE_URL is read only by Drizzle Kit's configuration boundary. The URL
 * value is validated but never interpolated into an error or logged.
 */
const environment = z
  .object({
    DATABASE_URL: z.string().url(),
  })
  .safeParse(process.env);

if (!environment.success) {
  throw new Error("DATABASE_URL is missing or invalid");
}

const databaseUrl = environment.data.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  strict: true,
  dbCredentials: {
    url: databaseUrl,
  },
});
