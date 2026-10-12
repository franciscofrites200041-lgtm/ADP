import { sql } from "drizzle-orm";

/**
 * Minimal shape of a database handle that {@link ping} needs. The typed
 * client produced by `createDbClient` satisfies it, which lets the API inject
 * a fake for readiness tests.
 */
export interface Pingable {
  execute(query: ReturnType<typeof sql>): PromiseLike<unknown>;
}

/**
 * Reports whether PostgreSQL is reachable.
 *
 * Intended for injected API readiness (`/readyz`): it never throws, so the
 * caller can map `false` to a non-ready response without leaking driver
 * details. The query never carries user input.
 */
export async function ping(db: Pingable): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
