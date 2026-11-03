import type { Credential, CredentialRepo } from "@middleware/core";
import { AliasTakenError } from "@middleware/core";
import { type DbClient, providerCredential as table } from "@middleware/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import postgres from "postgres";

const ALIAS_UNIQUE = "provider_credential_workspace_id_alias_active_unique";

// Everything the port returns; the secret columns are never selected.
const columns = {
  id: table.id,
  workspaceId: table.workspaceId,
  providerId: table.providerId,
  alias: table.alias,
  last4: table.last4,
  baseUrl: table.baseUrl,
  status: table.status,
  createdBy: table.createdBy,
  archivedAt: table.archivedAt,
};

type Row = Pick<typeof table.$inferSelect, keyof typeof columns>;

const toCredential = (row: Row): Credential => ({
  ...row,
  // Safe: `insert` is the only writer and it only takes a validated ProviderId.
  providerId: row.providerId as Credential["providerId"],
  // ponytail: both are always written by `insert`; nulls only come from rows
  // created outside this repo.
  last4: row.last4 ?? "",
  createdBy: row.createdBy ?? "",
});

// Drizzle wraps driver errors in DrizzleQueryError, keeping the original as `cause`.
const isAliasTaken = (error: unknown) =>
  [error, error instanceof Error ? error.cause : undefined].some(
    (e) =>
      e instanceof postgres.PostgresError &&
      e.code === "23505" &&
      e.constraint_name === ALIAS_UNIQUE,
  );

/**
 * Carries only the SQLSTATE. Drizzle and Postgres errors embed the query
 * parameters and the failing row, which hold the sealed secret (S2).
 */
export class PersistenceError extends Error {
  readonly code = "PERSISTENCE_FAILED";
  readonly sqlState: string | undefined;

  constructor(sqlState: string | undefined) {
    super("Credential storage failed");
    this.name = "PersistenceError";
    this.sqlState = sqlState;
  }
}

const sqlStateOf = (error: unknown) =>
  [error, error instanceof Error ? error.cause : undefined]
    .filter((e) => e instanceof postgres.PostgresError)
    .map((e) => e.code)[0];

// ponytail: driver errors without a SQLSTATE (connection loss) lose their
// detail here; add a sanitized cause when operations need it.
async function guardWrite<T>(query: Promise<T>): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if (isAliasTaken(error)) throw new AliasTakenError();
    throw new PersistenceError(sqlStateOf(error));
  }
}

/** Drizzle `CredentialRepo`: every query is scoped by `workspaceId` (S4). */
export function createCredentialRepo(db: DbClient): CredentialRepo {
  const active = (workspaceId: string, id: string) =>
    and(
      eq(table.workspaceId, workspaceId),
      eq(table.id, id),
      isNull(table.archivedAt),
    );
  const first = (rows: Row[]) => {
    const [row] = rows;
    return row ? toCredential(row) : null;
  };

  return {
    async insert(workspaceId, { secret, ...credential }) {
      const [row] = await guardWrite(
        db
          .insert(table)
          .values({ ...credential, ...secret, workspaceId })
          .returning(columns),
      );
      // Safe: an INSERT … RETURNING without ON CONFLICT yields exactly one row.
      return toCredential(row as Row);
    },
    async findById(workspaceId, id) {
      return first(
        await db.select(columns).from(table).where(active(workspaceId, id)),
      );
    },
    async findSealed(workspaceId, id) {
      const [row] = await db
        .select()
        .from(table)
        .where(active(workspaceId, id));
      if (!row) return null;
      const { ciphertext, iv, authTag, kekVersion } = row;
      if (!ciphertext || !iv || !authTag || !kekVersion) {
        // A row without a complete envelope cannot be probed: treat it as absent
        // instead of decrypting half a secret.
        return null;
      }
      return {
        ...toCredential(row),
        secret: {
          ciphertext,
          iv,
          authTag,
          kekVersion,
        },
      };
    },
    async setStatus(workspaceId, id, status) {
      return first(
        await db
          .update(table)
          .set({ status })
          .where(active(workspaceId, id))
          .returning(columns),
      );
    },
    async list(workspaceId) {
      const rows = await db
        .select(columns)
        .from(table)
        .where(
          and(eq(table.workspaceId, workspaceId), isNull(table.archivedAt)),
        )
        .orderBy(desc(table.id));
      return rows.map(toCredential);
    },
    async rename(workspaceId, id, alias) {
      return first(
        await guardWrite(
          db
            .update(table)
            .set({ alias })
            .where(active(workspaceId, id))
            .returning(columns),
        ),
      );
    },
    async archive(workspaceId, id, archivedAt) {
      return first(
        await db
          .update(table)
          .set({ archivedAt })
          .where(active(workspaceId, id))
          .returning(columns),
      );
    },
  };
}
