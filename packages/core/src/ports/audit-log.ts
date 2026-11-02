/** One `audit_log` row. Never carries a secret (S2). */
export type AuditEntry = {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, string>;
};

export type AuditLog = {
  record(workspaceId: string, entry: AuditEntry): Promise<void>;
};
