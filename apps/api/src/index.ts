import { serve } from "@hono/node-server";

import { app } from "./app.ts";

const port = 3001;

serve({ fetch: app.fetch, port });
