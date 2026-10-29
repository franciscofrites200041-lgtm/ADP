# WP-00 (slice): createContainer contract

Shared composition root required by WP-06 S5. Stacked on `wp-06-envelope-encryption`.
This slice is the contracts PR of MAESTRO_PLATAFORMA.md §13.2: no implementation.

## Specs
1. S1 — "`createContainer(env)` arma todo. Vive en `packages/adapters/src/container.ts`: valida la configuración con Zod y devuelve las dependencias" (§5)
2. S2 — "`createContainer` (y por lo tanto `apps/api` y `apps/worker`) **se niega a arrancar** si existe alguna variable de key de proveedor conocida" (§8, S3)
3. S3 — "Solo los puntos de entrada (`apps/api/src/main.ts` y `apps/worker/src/main.ts`) importan `createContainer`." (§5)
4. S4 — "Todo WP que toque más de una capa abre con un **PR de contratos**, sin implementación [...] Luca aprueba ese PR. Recién entonces se implementa" (§13.2)

## Tasks
- [x] T1 (S1-S2, S4): Contract: `containerEnvSchema`, `Container`, `ContainerConfigError`, `createContainer` signature and its required order, plus tests that fail red. Route: inline. Evidence: `container.test.ts` (3 unit tests red, 1 PostgreSQL test opt-in) and `container.ts` stub. Commit: pending.
- [ ] T2 (S1-S3): Implement `createContainer` and make `apps/api` and `apps/worker` call it from `main.ts`, replacing `readEnv` and `checkWorkerEnv`. Blocked on Luca approving T1.

## Open decisions for Luca
1. **Scope of the container now.** The contract covers config, keyring, SQL pool and the workspace key vault (what WP-06 needs). Better Auth and the SMTP mailer stay composed in `apps/api` until WP-03 and WP-54. Recommended: smaller PR, S2 is still satisfied because both processes call the container.
2. **Ports and overrides.** `Clock`, `Mailer` and replaceable ports (§5 "puertos reemplazados") are not defined: no consumer exists yet. Add them with the first use case that needs one.
3. **Master key parsing.** `keyringFromEnv` still validates by hand. Moving it to a Zod schema is possible inside T2 or later.
4. **Blocked variables.** `AWS_PROFILE` and other cloud variables are on the provider list, so API and worker will not start on a host that sets them for another purpose (for example S3 backups). Keep, or narrow the list against the adopted `pi-ai` version?

## Log
- L1 — User request: "okay, haz todo lo necesario para terminar"
- L2 — Codex hit its usage limit; GGA moved to Claude (ADR-0004, pending Luca's ratification).
