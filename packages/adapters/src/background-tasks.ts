import type { BackgroundTasks } from "@middleware/core";

/**
 * In-memory `BackgroundTasks`: the set of promises the process waits for on
 * shutdown (§5). `track` registers, `drain` waits with a timeout so a stuck
 * task cannot hang the shutdown forever.
 */
export function createBackgroundTasks(): BackgroundTasks {
  const pending = new Set<Promise<void>>();

  return {
    track(task: () => Promise<void>) {
      const running = task();
      const registered = running.finally(() => {
        pending.delete(registered);
      });
      pending.add(registered);
      // The registry observes the registered promise (not just the task), so
      // a fire-and-forget task never becomes an unhandled rejection;
      // `track` still rethrows to callers who await it.
      void registered.catch(() => {});
      return running;
    },

    async drain(timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      try {
        const settled = Promise.allSettled([...pending]).then(
          () => "done" as const,
        );
        return (await Promise.race([settled, timeout])) === "done";
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
