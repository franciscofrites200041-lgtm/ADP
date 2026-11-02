import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { serve } from "@hono/node-server";
import { createContainer } from "@middleware/adapters";
import { createDbClient, ping } from "@middleware/db";

import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { readEnv } from "./env.ts";
import { createSmtpMailer } from "./mailer.ts";

const port = 3001;

// First: refuses provider keys and invalid configuration before anything starts (S3).
const container = await createContainer(process.env);
const { BETTER_AUTH_SECRET, BETTER_AUTH_URL, SMTP_URL, MAIL_FROM } = readEnv(
  process.env,
);
// Better Auth keeps its own Drizzle client until WP-03 moves it into the container.
const dbClient = createDbClient(container.env.DATABASE_URL);
// The adapter reads the schema from the client (`db._.fullSchema`).
const auth = createAuth({
  database: drizzleAdapter(dbClient, { provider: "pg" }),
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,
  mailer: createSmtpMailer(SMTP_URL, MAIL_FROM),
});
const app = createApp({ ready: () => ping(dbClient), auth });

serve({ fetch: app.fetch, port }, () => {
  console.log(`[api] listening on port ${port}`);
});
