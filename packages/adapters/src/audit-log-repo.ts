import type { AuditLog } from "@middleware/core";
import { auditLog, type DbClient } from "@middleware/db";

/** Appends to `audit_log`. `AuditEntry` has no field that could hold a secret (S2). */
export function createAuditLogRepo(db: DbClient): AuditLog {
  return {
    async record(workspaceId, entry) {
      await db.insert(auditLog).values({ ...entry, workspaceId });
    },
  };
}
