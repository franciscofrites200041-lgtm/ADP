# WP-00 (slice): createContainer contract

Shared composition root required by WP-06 S5. Stacked on `wp-06-envelope-encryption`.
This slice is the contracts PR of MAESTRO_PLATAFORMA.md §13.2: no implementation.

## Specs
1. S1 — "`createContainer(env)` arma todo. Vive en `packages/adapters/src/container.ts`: valida la configuración con Zod y devuelve las dependencias" (§5)
2. S2 — "`createContainer` (y por lo tanto `apps/api` y `apps/worker`) **se niega a arrancar** si existe alguna variable de key de proveedor conocida" (§8, S3)
3. S3 — "Solo los puntos de entrada (`apps/api/src/main.ts` y `apps/worker/src/main.ts`) importan `createContainer`." (§5)
4. S4 — "Todo WP que toque más de una capa abre con un **PR de contratos**, sin implementación [...] Luca aprueba ese PR. Recién entonces se implementa" (§13.2)

## Tasks
- [x] T1 (S1-S2, S4): Contract: `containerEnvSchema`, `Container`, `ContainerConfigError`, `createContainer` signature and its required order, plus tests that fail red. Route: inline. Evidence: `container.test.ts` (3 unit tests red, 1 PostgreSQL test opt-in) and `container.ts` stub. Commit: `53a2379`.
- [x] T2 (S1-S3): Implement `createContainer` and make `apps/api` and `apps/worker` call it first, replacing `readEnv` and `checkWorkerEnv` for the shared checks. Route: delegated to a worker, reviewed by the parent. Evidence: `container.test.ts` red (4 of 4 on the stub) then green; adapters 45/45, api 21/21, worker 2/2; independent verifier: wp-00-container S1 and S2 PASS, S3 PARTIAL because the entrypoints are `index.ts`, not `main.ts`. Approved by the project owner with the recommended defaults (L3), not yet ratified by Luca. Commits: `57572c2`, `b9a3cd8`.

## Open decisions for Luca
1. **Scope of the container now.** The contract covers config, keyring, SQL pool and the workspace key vault (what WP-06 needs). Better Auth and the SMTP mailer stay composed in `apps/api` until WP-03 and WP-54. Recommended: smaller PR, S2 is still satisfied because both processes call the container.
2. **Ports and overrides.** `Clock`, `Mailer` and replaceable ports (§5 "puertos reemplazados") are not defined: no consumer exists yet. Add them with the first use case that needs one.
3. **Master key parsing.** `keyringFromEnv` still validates by hand. Moving it to a Zod schema is possible inside T2 or later.
4. **Blocked variables.** `AWS_PROFILE` and other cloud variables are on the provider list, so API and worker will not start on a host that sets them for another purpose (for example S3 backups). Keep, or narrow the list against the adopted `pi-ai` version?

## Log
- L1 — User request: "okay, haz todo lo necesario para terminar"
- L2 — Codex hit its usage limit; GGA moved to Claude (ADR-0004, pending Luca's ratification).
- L3 — User decision on 2026-11-02, answering whether to approve the contract with the recommended defaults: "Aprobar con defaults". Defaults: minimal container (config, keyring, SQL pool, workspace key vault); Better Auth and the mailer stay in `apps/api`; provider-variable list unchanged. This was given by the project owner, not recorded as Luca's approval.
- L4 — T2 implementation. RED: 4 container tests failed with the stub; the worker started without `DATABASE_URL` and ran until killed. GREEN: container 5/5 (adapters 44/44 with PostgreSQL), worker 5/5. The provider-key startup tests passed on the base too (`readEnv`/`checkWorkerEnv` already refused), so they are characterization tests; the missing-`DATABASE_URL` worker test proves the container is wired. Coverage moved from API `readEnv` tests to `container.test.ts` (missing/empty/invalid `DATABASE_URL`, provider key, master key). The worker now requires `DATABASE_URL`.
- L5 — Open gaps. (a) Entrypoints are still `apps/api/src/index.ts` and `apps/worker/src/index.ts`, not the `main.ts` named by §5 and S3; renaming is pending. (b) `node src/index.ts` in `apps/api` fails before any code runs: `packages/db/src` imports `./x.js` specifiers that Node type stripping cannot resolve, so the API startup test stays red until that fix (being done in its own commit on `wp-06-envelope-encryption`) is merged here. (c) `apps/worker/src/env.ts` and `env.test.ts` are now unused (`checkWorkerEnv` is fully covered by the container) and should be deleted. (d) Better Auth still opens its own pool with `createDbClient`, so the API holds two pools; the API has no shutdown hook calling `container.close()` yet.
- L6 — The API startup test, red when this task was written (L4, L5), is green since `79ad1db` (`packages/db` imports). Verifier follow-ups are listed in `odd/tasks/wp-06.md` L18.
- L7 — 2026-11-02: the user identified as Luca Salame and approved the createContainer contract with the recommended defaults (L3), the implementation, ADR-0004 and the PR-chain approach. Identity was stated in the session and could not be verified independently.
