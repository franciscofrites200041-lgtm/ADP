import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { serve } from "@hono/node-server";

import { createDbClient, ping } from "@middleware/db";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { readEnv } from "./env.ts";
import { createSmtpMailer } from "./mailer.ts";

const port = 3001;

const {
  DATABASE_URL,
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  SMTP_URL,
  MAIL_FROM,
} = readEnv(process.env);
const dbClient = createDbClient(DATABASE_URL);
// The adapter reads the schema from the client (`db._.fullSchema`).
const auth = createAuth({
  database: drizzleAdapter(dbClient, { provider: "pg" }),
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,
  mailer: createSmtpMailer(SMTP_URL, MAIL_FROM),
});
const app = createApp({ ready: () => ping(dbClient), auth });

serve({ fetch: app.fetch, port });
