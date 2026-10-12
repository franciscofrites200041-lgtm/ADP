import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import {
  deliveryChannelKind,
  deliveryChannelStatus,
  deliveryStatus,
  deliveryTargetFormat,
  deliveryTargetOwnerType,
} from "./enums.js";
import { run } from "./run.js";

/** A verified destination (email or WhatsApp number) the user can receive on. */
export const deliveryChannel = pgTable(
  "delivery_channel",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    kind: deliveryChannelKind("kind").notNull(),
    address: text("address").notNull(),
    label: varchar("label", { length: 255 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationCodeHash: varchar("verification_code_hash", { length: 64 }),
    whatsappWindowExpiresAt: timestamp("whatsapp_window_expires_at", {
      withTimezone: true,
    }),
    status: deliveryChannelStatus("status").notNull().default("pending"),
  },
  (table) => [index("delivery_channel_workspace_id_idx").on(table.workspaceId)],
);

/** Which channels receive the result of an agent, group or schedule. */
export const deliveryTarget = pgTable(
  "delivery_target",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    ownerType: deliveryTargetOwnerType("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => deliveryChannel.id),
    format: deliveryTargetFormat("format").notNull().default("full"),
  },
  (table) => [index("delivery_target_workspace_id_idx").on(table.workspaceId)],
);

/** A concrete send of a run's result to one channel. */
export const delivery = pgTable(
  "delivery",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => deliveryChannel.id),
    status: deliveryStatus("status").notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("delivery_workspace_id_idx").on(table.workspaceId),
    index("delivery_run_id_idx").on(table.runId),
    // Guarantees a run is delivered to a channel at most once.
    unique("delivery_run_id_channel_id_unique").on(
      table.runId,
      table.channelId,
    ),
    check("delivery_attempts_non_negative", sql`attempts >= 0`),
  ],
);
