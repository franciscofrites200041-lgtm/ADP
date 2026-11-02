import { createContainer } from "@middleware/adapters";

const HEARTBEAT_MS = 30_000;

// First: refuses provider keys and invalid configuration before anything starts (S3).
const container = await createContainer(process.env);

console.log("[worker] started (WP-01 shell)");

setInterval(() => {
  console.log("[worker] heartbeat");
}, HEARTBEAT_MS);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] received ${signal}, shutting down`);
    void container.close().finally(() => process.exit(0));
  });
}
