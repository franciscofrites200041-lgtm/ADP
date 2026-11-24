import type {
  LiveEventBus,
  LiveEventListener,
  LiveRunEvent,
} from "@middleware/core";

/**
 * In-memory `LiveEventBus`: a map of per-run listener sets, nothing else. No
 * timers and no module state: every process builds its own, and the whole
 * structure dies with it, exactly like the requests it feeds (S4).
 */
export function createInMemoryLiveEventBus(): LiveEventBus {
  const listeners = new Map<string, Set<LiveEventListener>>();

  return {
    publish(runId, message: LiveRunEvent) {
      const set = listeners.get(runId);
      if (!set) return;
      for (const listener of set) {
        // One broken subscriber (a half-closed SSE write, say) must not
        // break the others or the run that publishes.
        try {
          listener(message);
        } catch {
          // The durable copy in the event store is the system of record;
          // a live delivery failure loses nothing.
        }
      }
    },

    subscribe(runId, listener: LiveEventListener) {
      let set = listeners.get(runId);
      if (!set) {
        set = new Set();
        listeners.set(runId, set);
      }
      set.add(listener);
      return () => {
        const current = listeners.get(runId);
        if (!current) return;
        current.delete(listener);
        // Drop empty sets so a busy API never accumulates dead run keys.
        if (current.size === 0) listeners.delete(runId);
      };
    },
  };
}
