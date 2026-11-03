import type { ModelDescriptor } from "@middleware/contracts";

/**
 * Discovery is a network call per credential; a list that costs a provider
 * round trip on every render is unacceptable, and nothing changes minute to
 * minute. The contract is deliberately dumb so the cache can be in memory today
 * and shared later without touching the use case (WP-13).
 */
export type ModelCache = {
  read(key: string, now: Date): Promise<ModelDescriptor[] | null>;
  write(key: string, models: ModelDescriptor[], expiresAt: Date): Promise<void>;
};
