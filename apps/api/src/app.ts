import { Hono } from "hono";

export const app = new Hono();

app.get("/healthz", (c) => c.text("ok"));
app.get("/readyz", (c) => c.text("ok"));
