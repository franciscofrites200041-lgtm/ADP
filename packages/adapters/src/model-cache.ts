import type { ModelCache } from "@middleware/core";

/**
 * Process-local cache for model discovery (WP-13). Deliberately small and
 * bounded: a restart just costs one provider round trip, and an unbounded map
 * keyed by credential would leak memory on a long-lived API process.
 */
export function createInMemoryModelCache(
  options: { maxEntries?: number } = {},
): ModelCache {
  const maxEntries = options.maxEntries ?? 500;
  const entries = new Map<
    string,
    { models: Awaited<ReturnType<ModelCache["read"]>>; expiresAt: Date }
  >();

  return {
    async read(key, now) {
      const entry = entries.get(key);
      if (entry === undefined) return null;
      if (entry.expiresAt <= now) {
        entries.delete(key);
        return null;
      }
      return entry.models;
    },
    async write(key, models, expiresAt) {
      // Expired entries are dropped on read; here we only keep the map bounded.
      // Oldest insertion goes first: discovery is idempotent, so losing an
      // entry only costs one call.
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
      entries.set(key, { models, expiresAt });
    },
  };
}
