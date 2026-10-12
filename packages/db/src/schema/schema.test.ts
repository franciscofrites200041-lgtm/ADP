import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { agentTemplate, productTables } from "./index.js";

type ProductTable = (typeof productTables)[keyof typeof productTables];

type TableSpec = {
  dbName: string;
  columns: string[];
  indexes: string[][];
  uniques: string[][];
  primaryKeys: string[][];
  checks: string[];
  enumColumns: Record<string, string[]>;
};

/** Expected inventory straight from MIDDLEWARE_MASTER.md §7. */
const spec: Record<string, TableSpec> = {
  workspaceKey: {
    dbName: "workspace_key",
    columns: [
      "workspace_id",
      "kek_version",
      "wrapped_dek",
      "created_at",
      "rotated_at",
    ],
    indexes: [],
    uniques: [],
    primaryKeys: [["workspace_id"]],
    checks: [],
    enumColumns: {},
  },
  providerCredential: {
    dbName: "provider_credential",
    columns: [
      "id",
      "workspace_id",
      "provider_id",
      "alias",
      "ciphertext",
      "iv",
      "auth_tag",
      "kek_version",
      "last4",
      "base_url",
      "status",
      "last_checked_at",
      "created_by",
      "archived_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [["workspace_id", "alias"]],
    primaryKeys: [["id"]],
    checks: ["provider_credential_base_url_only_openai_compatible"],
    enumColumns: {
      status: ["unchecked", "valid", "invalid"],
    },
  },
  agent: {
    dbName: "agent",
    columns: [
      "id",
      "workspace_id",
      "name",
      "description",
      "current_version_id",
      "template_id",
      "created_by",
      "archived_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {},
  },
  agentVersion: {
    dbName: "agent_version",
    columns: [
      "id",
      "agent_id",
      "workspace_id",
      "version",
      "instructions",
      "provider_id",
      "model_id",
      "credential_id",
      "params",
      "tools",
      "created_by",
      "created_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [["agent_id", "version"]],
    primaryKeys: [["id"]],
    checks: ["agent_version_version_positive"],
    enumColumns: {},
  },
  toolConnection: {
    dbName: "tool_connection",
    columns: [
      "id",
      "workspace_id",
      "kind",
      "name",
      "config",
      "secret_ciphertext",
      "secret_iv",
      "secret_auth_tag",
      "secret_kek_version",
      "mode",
      "status",
      "archived_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {
      kind: ["web_search", "http", "mcp"],
      mode: ["read_only", "read_write"],
    },
  },
  conversation: {
    dbName: "conversation",
    columns: [
      "id",
      "workspace_id",
      "agent_id",
      "title",
      "created_by",
      "created_at",
      "updated_at",
      "archived_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {},
  },
  message: {
    dbName: "message",
    columns: [
      "id",
      "workspace_id",
      "conversation_id",
      "run_id",
      "role",
      "content",
      "created_at",
    ],
    indexes: [["workspace_id"], ["conversation_id", "created_at"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {
      role: ["user", "assistant", "tool_result"],
    },
  },
  run: {
    dbName: "run",
    columns: [
      "id",
      "workspace_id",
      "agent_id",
      "agent_version_id",
      "group_id",
      "parent_run_id",
      "root_run_id",
      "conversation_id",
      "trigger",
      "status",
      "input",
      "output",
      "error_code",
      "error_message",
      "idempotency_key",
      "api_token_id",
      "schedule_id",
      "queued_at",
      "started_at",
      "finished_at",
    ],
    indexes: [
      ["workspace_id"],
      ["workspace_id", "status"],
      ["conversation_id", "queued_at"],
      ["root_run_id"],
      ["group_id", "queued_at"],
    ],
    uniques: [["workspace_id", "idempotency_key"]],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {
      trigger: ["chat", "api", "schedule", "manual", "delegation"],
      status: [
        "queued",
        "running",
        "waiting_approval",
        "succeeded",
        "failed",
        "cancelled",
      ],
    },
  },
  runEvent: {
    dbName: "run_event",
    columns: [
      "id",
      "run_id",
      "workspace_id",
      "seq",
      "type",
      "payload",
      "created_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [["run_id", "seq"]],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {},
  },
  toolCall: {
    dbName: "tool_call",
    columns: [
      "id",
      "run_id",
      "workspace_id",
      "provider_tool_call_id",
      "tool_name",
      "args",
      "status",
      "result_summary",
      "is_error",
      "duration_ms",
      "started_at",
      "finished_at",
    ],
    indexes: [["workspace_id"], ["run_id"]],
    uniques: [["run_id", "provider_tool_call_id"]],
    primaryKeys: [["id"]],
    checks: ["tool_call_duration_non_negative"],
    enumColumns: {
      status: [
        "pending",
        "waiting_approval",
        "running",
        "succeeded",
        "failed",
        "denied",
      ],
    },
  },
  approval: {
    dbName: "approval",
    columns: [
      "id",
      "workspace_id",
      "run_id",
      "tool_call_id",
      "requested_at",
      "expires_at",
      "decision",
      "decided_by",
      "decided_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {
      decision: ["approved", "denied", "expired"],
    },
  },
  schedule: {
    dbName: "schedule",
    columns: [
      "id",
      "workspace_id",
      "target_type",
      "target_id",
      "name",
      "cron",
      "timezone",
      "input",
      "enabled",
      "last_run_id",
      "next_run_at",
      "created_by",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {
      target_type: ["agent", "group"],
    },
  },
  apiToken: {
    dbName: "api_token",
    columns: [
      "id",
      "workspace_id",
      "agent_id",
      "name",
      "prefix",
      "token_hash",
      "last_used_at",
      "revoked_at",
      "created_by",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {},
  },
  usageRecord: {
    dbName: "usage_record",
    columns: [
      "id",
      "workspace_id",
      "run_id",
      "agent_id",
      "provider_id",
      "model_id",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "cost_usd",
      "created_at",
    ],
    indexes: [["workspace_id"], ["workspace_id", "created_at"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [
      "usage_record_tokens_non_negative",
      "usage_record_cost_non_negative",
    ],
    enumColumns: {},
  },
  spendLimit: {
    dbName: "spend_limit",
    columns: [
      "id",
      "workspace_id",
      "scope",
      "scope_id",
      "monthly_usd",
      "action",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: ["spend_limit_monthly_usd_positive"],
    enumColumns: {
      scope: ["workspace", "agent", "credential"],
      action: ["warn", "block"],
    },
  },
  agentTemplate: {
    dbName: "agent_template",
    columns: [
      "id",
      "name",
      "description",
      "instructions",
      "suggested_params",
      "suggested_tools",
    ],
    indexes: [],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {},
  },
  auditLog: {
    dbName: "audit_log",
    columns: [
      "id",
      "workspace_id",
      "actor_user_id",
      "actor_token_id",
      "action",
      "target_type",
      "target_id",
      "metadata",
      "ip",
      "created_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {},
  },
  agentGroup: {
    dbName: "agent_group",
    columns: [
      "id",
      "workspace_id",
      "name",
      "description",
      "goal",
      "coordinator_agent_id",
      "mode",
      "max_delegations",
      "max_cost_usd",
      "created_by",
      "archived_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [
      "agent_group_max_delegations_positive",
      "agent_group_max_cost_usd_positive",
    ],
    enumColumns: {
      mode: ["coordinator"],
    },
  },
  agentGroupMember: {
    dbName: "agent_group_member",
    columns: [
      "group_id",
      "agent_id",
      "workspace_id",
      "slug",
      "role_description",
      "position",
    ],
    indexes: [["workspace_id"]],
    uniques: [["group_id", "slug"]],
    primaryKeys: [["group_id", "agent_id"]],
    checks: ["agent_group_member_position_non_negative"],
    enumColumns: {},
  },
  integration: {
    dbName: "integration",
    columns: [
      "id",
      "workspace_id",
      "provider",
      "account_email",
      "scopes",
      "refresh_ciphertext",
      "refresh_iv",
      "refresh_auth_tag",
      "refresh_kek_version",
      "access_expires_at",
      "status",
      "connected_by",
      "created_at",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {
      provider: ["google"],
      status: ["connected", "needs_reauth", "revoked"],
    },
  },
  deliveryChannel: {
    dbName: "delivery_channel",
    columns: [
      "id",
      "workspace_id",
      "kind",
      "address",
      "label",
      "verified_at",
      "verification_code_hash",
      "whatsapp_window_expires_at",
      "status",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {
      kind: ["email", "whatsapp"],
      status: ["pending", "verified", "disabled"],
    },
  },
  deliveryTarget: {
    dbName: "delivery_target",
    columns: [
      "id",
      "workspace_id",
      "owner_type",
      "owner_id",
      "channel_id",
      "format",
    ],
    indexes: [["workspace_id"]],
    uniques: [],
    primaryKeys: [["id"]],
    checks: [],
    enumColumns: {
      owner_type: ["agent", "group", "schedule"],
      format: ["full", "summary"],
    },
  },
  delivery: {
    dbName: "delivery",
    columns: [
      "id",
      "workspace_id",
      "run_id",
      "channel_id",
      "status",
      "provider_message_id",
      "error",
      "attempts",
      "created_at",
      "updated_at",
    ],
    indexes: [["workspace_id"], ["run_id"]],
    uniques: [["run_id", "channel_id"]],
    primaryKeys: [["id"]],
    checks: ["delivery_attempts_non_negative"],
    enumColumns: {
      status: ["pending", "sent", "delivered", "failed"],
    },
  },
};

function columnNames(table: ProductTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function indexColumnLists(table: ProductTable): string[][] {
  return getTableConfig(table).indexes.map((index) =>
    index.config.columns.map((column) => {
      if (typeof column === "string") return column;
      return "name" in column ? (column.name ?? "") : "";
    }),
  );
}

function uniqueColumnLists(table: ProductTable): string[][] {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name),
  );
}

function primaryKeyLists(table: ProductTable): string[][] {
  const config = getTableConfig(table);
  const columnLevel = config.columns
    .filter((candidate) => candidate.primary)
    .map((candidate) => candidate.name);
  const tableLevel = config.primaryKeys.map((key) =>
    key.columns.map((column) => column.name),
  );
  return tableLevel.length > 0
    ? tableLevel
    : columnLevel.length > 0
      ? [columnLevel]
      : [];
}

function checkNames(table: ProductTable): string[] {
  return getTableConfig(table).checks.map((check) => check.name);
}

function column(table: ProductTable, name: string) {
  return getTableConfig(table).columns.find(
    (candidate) => candidate.name === name,
  );
}

describe("product schema inventory (§7)", () => {
  const entries = Object.entries(productTables) as [string, ProductTable][];

  it("exports exactly the 23 product-owned tables and no Better Auth tables", () => {
    expect(Object.keys(spec).sort()).toEqual(Object.keys(productTables).sort());
    for (const [name, table] of entries) {
      expect(getTableConfig(table).name, name).toBe(spec[name]?.dbName);
    }
  });

  it("defines the expected columns for every table", () => {
    for (const [name, table] of entries) {
      expect(columnNames(table), name).toEqual(spec[name]?.columns);
    }
  });

  it("marks workspace_id non-null and indexed on every business table", () => {
    for (const [name, table] of entries) {
      if (name === "agentTemplate") {
        expect(columnNames(table)).not.toContain("workspace_id");
        continue;
      }

      const workspaceColumn = column(table, "workspace_id");
      expect(workspaceColumn?.notNull, name).toBe(true);

      const isPrimaryKey =
        workspaceColumn?.primary === true ||
        primaryKeyLists(table).some(
          (key) => key.length === 1 && key[0] === "workspace_id",
        );
      const hasWorkspaceIndex = indexColumnLists(table).some(
        (list) => list.length === 1 && list[0] === "workspace_id",
      );
      expect(isPrimaryKey || hasWorkspaceIndex, name).toBe(true);
    }
  });

  it("defaults every uuid primary id to app-generated UUIDv7", () => {
    for (const [name, table] of entries) {
      const id = column(table, "id");
      if (!id) continue; // workspace_key and agent_group_member have no `id`.
      if (id.columnType !== "PgUUID" || !id.primary) continue; // run_event is bigserial.

      expect(id.hasDefault, name).toBe(true);
      expect(typeof id.defaultFn, name).toBe("function");
    }
  });

  it("uses timestamptz (with timezone) for every timestamp column", () => {
    for (const [name, table] of entries) {
      for (const timestampColumn of getTableConfig(table).columns.filter(
        (candidate) => candidate.columnType === "PgTimestamp",
      )) {
        const withTimezone = (
          timestampColumn as unknown as { withTimezone: boolean }
        ).withTimezone;
        expect(withTimezone, `${name}.${timestampColumn.name}`).toBe(true);
      }
    }
  });

  it("uses numeric(14,6) for every money column", () => {
    const moneyColumns: [string, string][] = [
      ["usageRecord", "cost_usd"],
      ["spendLimit", "monthly_usd"],
      ["agentGroup", "max_cost_usd"],
    ];

    for (const [tableName, columnName] of moneyColumns) {
      const moneyColumn = column(
        productTables[tableName as keyof typeof productTables],
        columnName,
      );
      expect(moneyColumn?.columnType, `${tableName}.${columnName}`).toBe(
        "PgNumeric",
      );
      const numericConfig = moneyColumn as unknown as {
        precision?: number;
        scale?: number;
      };
      expect(numericConfig.precision, `${tableName}.${columnName}`).toBe(14);
      expect(numericConfig.scale, `${tableName}.${columnName}`).toBe(6);
    }
  });

  it("defines the mandated enum values", () => {
    for (const [name, table] of entries) {
      const expectedEnums = spec[name]?.enumColumns ?? {};
      for (const [columnName, values] of Object.entries(expectedEnums)) {
        const enumColumn = column(table, columnName);
        expect(enumColumn?.enumValues, `${name}.${columnName}`).toEqual(values);
      }
    }
  });

  it("defines the mandated unique constraints", () => {
    for (const [name, table] of entries) {
      expect(uniqueColumnLists(table), name).toEqual(spec[name]?.uniques ?? []);
    }
  });

  it("defines the mandated indexes", () => {
    for (const [name, table] of entries) {
      expect(indexColumnLists(table), name).toEqual(spec[name]?.indexes ?? []);
    }
  });

  it("defines the mandated primary keys", () => {
    for (const [name, table] of entries) {
      expect(primaryKeyLists(table), name).toEqual(
        spec[name]?.primaryKeys ?? [],
      );
    }
  });

  it("defines the mandated check constraints", () => {
    for (const [name, table] of entries) {
      expect(checkNames(table).sort(), name).toEqual(
        [...(spec[name]?.checks ?? [])].sort(),
      );
    }
  });

  it("keeps the global agent_template free of any workspace_id", () => {
    expect(columnNames(agentTemplate)).not.toContain("workspace_id");
  });
});
