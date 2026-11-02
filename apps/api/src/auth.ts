import { createId } from "@middleware/db";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

import { createAuthEmailCallbacks } from "./auth-emails.ts";
import type { Mailer } from "./mailer.ts";

export interface CreateAuthOptions {
  /** Better Auth database config, e.g. `drizzleAdapter(db, { provider: "pg" })`. */
  database: BetterAuthOptions["database"];
  secret: string;
  baseURL: string;
  mailer: Mailer;
}

/** A user without a workspace breaks an invariant; `apps/api` answers 500. */
class WorkspaceResolutionError extends Error {
  readonly code = "WORKSPACE_MISSING";

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceResolutionError";
  }
}
/**
 * Builds Better Auth (email/password + organization plugin). Identifiers use
 * the application's UUIDv7 generator. Each user gets exactly one organization
 * (= workspace) as `owner`, and every new session is pinned to it, so the
 * active workspace only ever comes from the session.
 *
 * The workspace is created in `user.create.after`, once per user. Registration
 * does not sign anyone in (`requireEmailVerification`), so no session exists
 * yet; `session.create.before` only looks the workspace up and pins it.
 */

export function createAuth({
  database,
  secret,
  baseURL,
  mailer,
}: CreateAuthOptions) {
  const { sendVerificationEmail, sendResetPassword } =
    createAuthEmailCallbacks(mailer);
  return betterAuth({
    database,
    secret,
    baseURL,
    emailAndPassword: {
      enabled: true,
      sendResetPassword,
      // S10: no session before the user clicks the link in their inbox.
      requireEmailVerification: true,
    },
    emailVerification: {
      sendVerificationEmail,
      sendOnSignUp: true,
      // A rejected sign-in resends the link, so a lost mail is not a dead end.
      sendOnSignIn: true,
    },
    advanced: { database: { generateId: createId } },
    plugins: [organization({ allowUserToCreateOrganization: false })],
    databaseHooks: {
      user: {
        create: {
          // One workspace per user, created once when the user is created.
          after: async (user, ctx) => {
            const adapter = ctx?.context.adapter;
            if (!adapter) return;
            const workspace = await adapter.create<{ id: string }>({
              model: "organization",
              data: {
                name: user.name || "Workspace",
                slug: `ws-${user.id}`,
                createdAt: new Date(),
              },
            });
            await adapter.create({
              model: "member",
              data: {
                organizationId: workspace.id,
                userId: user.id,
                role: "owner",
                createdAt: new Date(),
              },
            });
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const adapter = ctx?.context.adapter;
            if (!adapter) {
              throw new WorkspaceResolutionError(
                "workspace resolution requires an auth context",
              );
            }
            const member = await adapter.findOne<{ organizationId: string }>({
              model: "member",
              where: [{ field: "userId", value: session.userId }],
            });
            if (!member) {
              // Users get their workspace at creation; a missing one is a bug.
              throw new WorkspaceResolutionError("workspace missing for user");
            }
            return {
              data: { ...session, activeOrganizationId: member.organizationId },
            };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
