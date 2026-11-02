import {
  createCredentialRequestSchema,
  credentialIdParamSchema,
  providerCatalog,
  renameCredentialRequestSchema,
} from "@middleware/contracts";
import type { CredentialService } from "@middleware/core";
import { type Context, Hono } from "hono";

import {
  requireWorkspace,
  type SessionReader,
  type WorkspaceEnv,
} from "./workspace.ts";

type Handler = (c: Context<WorkspaceEnv>) => Promise<Response>;

// Malformed JSON becomes `undefined`, which the schema rejects as invalid_request.
const readJson = (c: Context): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const idOf = (c: Context) => credentialIdParamSchema.parse(c.req.param()).id;

/** Thin handlers: parse, call the use case, return its result as is. */
function credentialHandlers(credentials: CredentialService) {
  return {
    list: async (c) =>
      c.json({
        credentials: await credentials.listCredentials(c.get("workspaceId")),
      }),
    create: async (c) => {
      const input = createCredentialRequestSchema.parse(await readJson(c));
      const created = await credentials.createCredential(
        c.get("workspaceId"),
        c.get("userId"),
        input,
      );
      return c.json(created, 201);
    },
    rename: async (c) => {
      const id = idOf(c);
      const input = renameCredentialRequestSchema.parse(await readJson(c));
      return c.json(
        await credentials.renameCredential(
          c.get("workspaceId"),
          c.get("userId"),
          id,
          input,
        ),
      );
    },
    archive: async (c) => {
      const id = idOf(c);
      await credentials.archiveCredential(
        c.get("workspaceId"),
        c.get("userId"),
        id,
      );
      return c.body(null, 204);
    },
  } satisfies Record<string, Handler>;
}

/**
 * `GET /api/providers` and the credential CRUD (§10), all behind the session.
 * Errors go to the app's `onError`.
 */
export function credentialRoutes(
  auth: SessionReader,
  credentials: CredentialService,
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  const session = requireWorkspace(auth);
  const handle = credentialHandlers(credentials);

  app.get("/api/providers", session, (c) =>
    c.json({ providers: providerCatalog }),
  );
  app.get("/api/credentials", session, handle.list);
  app.post("/api/credentials", session, handle.create);
  app.patch("/api/credentials/:id", session, handle.rename);
  app.delete("/api/credentials/:id", session, handle.archive);

  return app;
}
