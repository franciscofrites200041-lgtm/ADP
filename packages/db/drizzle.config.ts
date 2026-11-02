import { defineConfig } from "drizzle-kit";
import { z } from "zod";

/**
 * DATABASE_URL is read only by Drizzle Kit's configuration boundary. The URL
 * value is validated but never interpolated into an error or logged.
 */
const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });

const readDatabaseUrl = (): string => {
  const parsed = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
  if (!parsed.success) {
    throw new Error("DATABASE_URL is missing or invalid");
  }
  return parsed.data;
};

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  strict: true,
  dbCredentials: {
    get url() {
      return readDatabaseUrl();
    },
  },
});
