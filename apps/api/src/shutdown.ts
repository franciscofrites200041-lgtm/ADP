import type { Logger } from "pino";

/** What the handler needs from the HTTP server. */
type ClosableServer = { close(callback: (error?: Error) => void): void };

export type ShutdownDeps = {
  server: ClosableServer;
  /** Closes pools and anything else that must drain (§5). */
  close: () => Promise<void>;
  logger: Pick<Logger, "info" | "error">;
  /** `MW_SHUTDOWN_GRACE_SECONDS`; after it the process exits anyway. */
  graceMs: number;
  exit: (code: number) => void;
  signals?: readonly NodeJS.Signals[];
};

/**
 * Graceful shutdown: stop accepting connections, wait for `close`, then exit 0.
 * If anything hangs past `graceMs`, log and exit 1 instead of hanging forever.
 * Returns a dispose function so tests can detach the listeners.
 */
export function registerShutdown({
  server,
  close,
  logger,
  graceMs,
  exit,
  signals = ["SIGTERM", "SIGINT"],
}: ShutdownDeps): () => void {
  let started = false;

  const handlers = () =>
    signals.map(
      (signal) =>
        [
          signal,
          () => {
            if (started) return;
            started = true;
            logger.info({ signal }, "shutting down");

            const timer = setTimeout(() => {
              logger.error({ signal, graceMs }, "shutdown grace expired");
              exit(1);
            }, graceMs);
            // Do not keep the process alive just for the timer.
            timer.unref?.();

            server.close(() => {
              close()
                .then(() => {
                  clearTimeout(timer);
                  logger.info("shutdown complete");
                  exit(0);
                })
                .catch((error: unknown) => {
                  clearTimeout(timer);
                  logger.error(
                    {
                      errorName: error instanceof Error ? error.name : "Error",
                    },
                    "shutdown failed",
                  );
                  exit(1);
                });
            });
          },
        ] as const,
    );

  const attached = handlers();
  for (const [signal, handler] of attached) process.on(signal, handler);

  return () => {
    for (const [signal, handler] of attached) process.off(signal, handler);
  };
}
