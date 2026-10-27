import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

const migrationSql = readdirSync(drizzleDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(drizzleDir, file), "utf8"))
  .join("\n");

/** Product-owned table names from MIDDLEWARE_MASTER.md §7 (§7 inventory). */
const productTableNames = [
  "workspace_key",
  "provider_credential",
  "agent",
  "agent_version",
  "tool_connection",
  "conversation",
  "message",
  "run",
  "run_event",
  "tool_call",
  "approval",
  "schedule",
  "api_token",
  "usage_record",
  "spend_limit",
  "agent_template",
  "audit_log",
  "agent_group",
  "agent_group_member",
  "integration",
  "delivery_channel",
  "delivery_target",
  "delivery",
] as const;

/** Better Auth core and organization-plugin tables from MIDDLEWARE_MASTER.md §7. */
const authTableNames = [
  "user",
  "session",
  "account",
  "verification",
  "organization",
  "member",
  "invitation",
] as const;

describe("generated migration artifact", () => {
  it("contains a CREATE TABLE statement for every product-owned table", () => {
    for (const table of productTableNames) {
      expect(migrationSql, table).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("emits product and Better Auth tables without unrelated tables", () => {
    const createTableStatements = migrationSql.match(/CREATE TABLE "[^"]+"/g);
    expect(createTableStatements).toHaveLength(
      productTableNames.length + authTableNames.length,
    );

    for (const table of authTableNames) {
      expect(migrationSql, table).toContain(`CREATE TABLE "${table}"`);
    }
  });
});
