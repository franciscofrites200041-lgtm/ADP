import { serve } from "@hono/node-server";

import { createDbClient, ping } from "@middleware/db";
import { createApp } from "./app.ts";
import { readEnv } from "./env.ts";

const port = 3001;

const { DATABASE_URL } = readEnv(process.env);
const dbClient = createDbClient(DATABASE_URL);
const app = createApp({ ready: () => ping(dbClient) });

serve({ fetch: app.fetch, port });
