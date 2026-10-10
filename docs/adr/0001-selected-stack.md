# ADR-0001: Adopt the Middleware MVP stack

- Status: Accepted
- Date: 2026-10-09

## Context

Middleware needs a multi-user, provider-neutral agent platform with persistent execution state, scheduled work, secure user-owned credentials, and self-hosted deployment. The authoritative product and security constraints are defined in MIDDLEWARE_MASTER.md §3.

## Decision

Adopt the closed technical decisions from §3 without modification:

- TypeScript in strict mode across the stack.
- A pnpm and Turborepo monorepo with Next.js web, Hono API, and pg-boss worker applications.
- PostgreSQL with Drizzle ORM.
- Pi packages for model providers, agent execution, MCP, and the JavaScript sandbox.
- Better Auth with organizations for workspace isolation.
- Docker Compose and Caddy on a self-managed VPS.
- Hexagonal architecture in packages/core, with adapters outside the domain.

## Consequences

The repository foundation must enforce strict TypeScript and support deterministic unit tests. Framework-specific implementation remains outside this WP and must preserve the dependency direction set by §5.

## Alternatives considered

The alternatives listed in MIDDLEWARE_MASTER.md §3 were rejected by the documented decisions and are not reopened by this ADR.
