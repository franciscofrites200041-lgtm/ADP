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

/**
 * Builds Better Auth (email/password + organization plugin). Identifiers use
 * the application's UUIDv7 generator. Each user gets exactly one organization
 * (= workspace) as `owner`, and every new session is pinned to it, so the
 * active workspace only ever comes from the session.
 *
 * The workspace is created in `session.create.before` rather than
 * `user.create.after` because Better Auth defers "after" hooks until the
 * sign-up request ends, i.e. after the first session already exists. Sign-up
 * auto-signs in, so the workspace still exists from registration.
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
    emailAndPassword: { enabled: true, sendResetPassword },
    emailVerification: { sendVerificationEmail, sendOnSignUp: true },
    advanced: { database: { generateId: createId } },
    plugins: [organization({ allowUserToCreateOrganization: false })],
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            const adapter = ctx?.context.adapter;
            if (!adapter) {
              throw new Error("workspace resolution requires an auth context");
            }
            const member = await adapter.findOne<{ organizationId: string }>({
              model: "member",
              where: [{ field: "userId", value: session.userId }],
            });
            let workspaceId = member?.organizationId;
            if (!workspaceId) {
              const user = await adapter.findOne<{ name: string }>({
                model: "user",
                where: [{ field: "id", value: session.userId }],
              });
              const workspace = await adapter.create<{ id: string }>({
                model: "organization",
                data: {
                  name: user?.name ?? "Workspace",
                  slug: `ws-${session.userId}`,
                  createdAt: new Date(),
                },
              });
              await adapter.create({
                model: "member",
                data: {
                  organizationId: workspace.id,
                  userId: session.userId,
                  role: "owner",
                  createdAt: new Date(),
                },
              });
              workspaceId = workspace.id;
            }
            return { data: { ...session, activeOrganizationId: workspaceId } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
