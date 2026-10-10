const HEARTBEAT_MS = 30_000;

console.log("[worker] started (WP-01 shell)");

setInterval(() => {
  console.log("[worker] heartbeat");
}, HEARTBEAT_MS);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] received ${signal}, shutting down`);
    process.exit(0);
  });
}
