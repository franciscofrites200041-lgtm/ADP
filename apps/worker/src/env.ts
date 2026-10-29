import { assertNoProviderKeys, keyringFromEnv } from "@middleware/adapters";

/**
 * Startup guard for the worker: refuses provider credential variables and
 * validates the master key (S1, S5). Throws; the caller must not start.
 */
export function checkWorkerEnv(env: NodeJS.ProcessEnv): void {
  assertNoProviderKeys(env);
  keyringFromEnv(env);
}
