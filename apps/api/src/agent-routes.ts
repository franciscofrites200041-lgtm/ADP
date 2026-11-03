import {
  agentIdParamSchema,
  createAgentRequestSchema,
  duplicateAgentRequestSchema,
  restoreAgentVersionRequestSchema,
  updateAgentRequestSchema,
} from "@middleware/contracts";
import type { AgentService } from "@middleware/core";
import { type Context, Hono } from "hono";

import { requireOrigin } from "./origin.ts";
import {
  requireWorkspace,
  type SessionReader,
  type WorkspaceEnv,
} from "./workspace.ts";

const readJson = (c: Context): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const idOf = (c: Context) => agentIdParamSchema.parse(c.req.param()).id;

/** Thin handlers: parse, call the use case, return its result as is. */
function agentHandlers(agents: AgentService) {
  return {
    list: async (c: Context<WorkspaceEnv>) =>
      c.json({ agents: await agents.listAgents(c.get("workspaceId")) }),

    create: async (c: Context<WorkspaceEnv>) => {
      const input = createAgentRequestSchema.parse(await readJson(c));
      const created = await agents.createAgent(
        c.get("workspaceId"),
        c.get("userId"),
        input,
      );
      return c.json(created, 201);
    },

    get: async (c: Context<WorkspaceEnv>) =>
      c.json(await agents.getAgent(c.get("workspaceId"), idOf(c))),

    update: async (c: Context<WorkspaceEnv>) => {
      const input = updateAgentRequestSchema.parse(await readJson(c));
      return c.json(
        await agents.updateAgent(
          c.get("workspaceId"),
          c.get("userId"),
          idOf(c),
          input,
        ),
      );
    },

    versions: async (c: Context<WorkspaceEnv>) =>
      c.json({
        versions: await agents.listVersions(c.get("workspaceId"), idOf(c)),
      }),

    restore: async (c: Context<WorkspaceEnv>) => {
      const input = restoreAgentVersionRequestSchema.parse(await readJson(c));
      return c.json(
        await agents.restoreVersion(
          c.get("workspaceId"),
          c.get("userId"),
          idOf(c),
          input.versionId,
        ),
      );
    },

    duplicate: async (c: Context<WorkspaceEnv>) => {
      const input = duplicateAgentRequestSchema.parse(await readJson(c));
      const copy = await agents.duplicateAgent(
        c.get("workspaceId"),
        c.get("userId"),
        idOf(c),
        input,
      );
      return c.json(copy, 201);
    },

    templates: async (c: Context<WorkspaceEnv>) =>
      c.json({ templates: await agents.listTemplates() }),

    archive: async (c: Context<WorkspaceEnv>) => {
      await agents.archiveAgent(c.get("workspaceId"), c.get("userId"), idOf(c));
      return c.body(null, 204);
    },
  } satisfies Record<string, (c: Context<WorkspaceEnv>) => Promise<Response>>;
}

/** The agent CRUD (§10), all behind the session. Errors go to `onError`. */
export function agentRoutes(
  auth: SessionReader,
  agents: AgentService,
  allowedOrigins: readonly string[],
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  const session = requireWorkspace(auth);
  // S10: writes check the origin; reads do not.
  const write = requireOrigin(allowedOrigins);
  const handle = agentHandlers(agents);

  // Templates are a global catalogue, but still require a session: they are
  // product content, not public data.
  app.get("/api/agent-templates", session, handle.templates);
  app.get("/api/agents", session, handle.list);
  app.post("/api/agents", session, write, handle.create);
  app.get("/api/agents/:id", session, handle.get);
  app.patch("/api/agents/:id", session, write, handle.update);
  app.delete("/api/agents/:id", session, write, handle.archive);
  app.get("/api/agents/:id/versions", session, handle.versions);
  app.post("/api/agents/:id/restore", session, write, handle.restore);
  app.post("/api/agents/:id/duplicate", session, write, handle.duplicate);

  return app;
}
