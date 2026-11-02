---
name: mw-patterns
description: Copy the shape of the reference slice when adding a new feature to Middleware (a CRUD resource that crosses schema, contracts, core, adapters, API and web). Use it before writing code for any new feature, and when reviewing a PR for consistency with the slice.
---

# mw-patterns: build like the reference slice

The reference slice is WP-10 (the provider credential vault). Every later WP copies its shape: same layers, same order, same tests.
Evidence and decisions: `odd/tasks/wp-10.md`.

## Flow (do not reorder)

1. **Schema and migration** — `packages/db/src/schema/` + `drizzle/`. Additive migrations only; never edit an applied one.
2. **Contracts** — Zod request/response/param schemas in `packages/contracts/src/`. Types come from `z.infer`, never hand-written.
3. **Core** — domain types, typed errors, ports, use cases in `packages/core/src/{domain,ports,usecases}/`.
4. **Adapters** — repository, vault/user of secrets, audit log in `packages/adapters/src/`; wire them in `packages/adapters/src/container.ts`.
5. **API** — thin Hono routes in `apps/api/src/`, behind `requireWorkspace` and, for writes, `requireOrigin`.
6. **Web** — a route folder under `apps/web/src/app/(app)/<route>/` with the data hooks beside its page, the screen, and its components. Texts in `apps/web/src/messages.ts`.
7. **Tests at each border** — unit beside the file, real-Postgres integration (opt-in `DATABASE_URL_TEST`), cross-tenant, redaction, and one Playwright spec for the user-visible flow (`tests/e2e/`).

## The file to copy per layer

| Layer | Model file | Conventions it demonstrates |
| --- | --- | --- |
| Schema | `packages/db/src/schema/credential.ts` | `workspaceId` not null and indexed; partial unique index for "active only"; a `check` that keeps a column meaningful |
| Contracts | `packages/contracts/src/credentials.ts` | `z.strictObject` everywhere; response schema without secret fields; `safeParse` results, never `as` |
| Domain | `packages/core/src/domain/errors.ts` | typed errors extending `DomainError` with a `code` from the contracts enum; the only allowed classes |
| Ports | `packages/core/src/ports/credential-repo.ts` | `workspaceId` first in every method; `null` for missing or foreign rows; the port documents what it throws |
| Use cases | `packages/core/src/usecases/credentials.ts` | factory with explicit deps; `toResponse` picks public fields by name; audit entries without secrets |
| Adapters | `packages/adapters/src/credential-repo.ts` | one SQL compare-and-swap instead of read-then-write; driver errors converted to typed ones that carry no row data |
| Vault | `packages/adapters/src/credential-secret-vault.ts` | secrets sealed with the workspace DEK and AAD `workspace:table:id`; the packed blob split into the three table columns |
| Composition | `packages/adapters/src/container.ts` | one `createContainer(env)`: provider env guard → Zod config → keyring → pools; secrets non-enumerable |
| API routes | `apps/api/src/credentials-routes.ts` | parse with the contract schema, call the use case, return its result untouched |
| API session | `apps/api/src/workspace.ts` | `workspaceId` comes only from the session; 401 otherwise |
| API errors | `apps/api/src/http-errors.ts` | one mapper; Spanish messages from `apps/api/src/messages.ts`; only name and code of an unknown error are logged |
| Web data | `apps/web/src/app/(app)/providers/queries.ts` | relative same-origin calls, responses parsed with contracts, contract failures become a Spanish message |
| Web screen | `apps/web/src/app/(app)/providers/providers-screen.tsx` | states: loading, empty, error with retry; one primary orange button |
| Web form | `apps/web/src/app/(app)/providers/credential-form.tsx` | React Hook Form validated with the contract schema; the secret is cleared after success |
| E2E | `tests/e2e/providers.spec.ts` | session created through the API; skips without `DATABASE_URL_TEST`; asserts a secret never reaches the page |

## Traps this slice already hit (do not repeat them)

- A provider key in the server environment must block startup: `assertNoProviderKeys` runs first in `createContainer`.
- The vault returns one packed base64 `iv|tag|ciphertext`; the table has three columns. Split and join, never store the blob.
- A `ZodError` must never reach the user: catch it and throw the Spanish fallback.
- Constructor parameter properties, `enum` and `namespace` crash under `node src/index.ts` (type stripping). Use plain fields.
- `packages/db` needs `.ts` import specifiers or Node cannot resolve the imports.
- Better Auth needs `organization.metadata`; without it every `/api/auth/*` answers 500.
- Sign-in requires a verified email; tests set `email_verified` directly because the link lives in the mail sink.
- Write routes check the request `Origin`; the browser origin must be the one the API is configured with.
- Windows checkouts report CRLF noise from Biome; revert line-ending-only changes before committing.

## Reviewer checklist

Mirror of section 13.4 of `MAESTRO_PLATAFORMA.md`: one thing per PR, ≤400 lines, a test per rule, no secret in responses/logs/errors, a cross-tenant test per endpoint, follows this slice, no TODOs or unused exports, `odd/tasks/<wp>.md` updated.
