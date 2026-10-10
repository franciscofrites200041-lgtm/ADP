# AGENTS.md: reglas del repo Middleware

## Fuente de verdad
- MIDDLEWARE_MASTER.md define producto, arquitectura, seguridad y plan. Leelo antes de cambiar algo.
- No cambies una decisión de §3 sin un ADR aprobado por Luca.

## Lenguaje y estilo
- TypeScript estricto (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Prohibido `any`; usá `unknown` y validá.
- Biome para lint y formato; el CI falla con cualquier warning.
- Identificadores, código y commits en inglés. Textos de UI y mensajes de error al usuario en español rioplatense, desde el archivo de mensajes.
- Archivos en kebab-case; componentes React en PascalCase; un componente por archivo.
- Conventional Commits (`feat(api): …`, `fix(web): …`).

## Arquitectura
- `packages/core` no importa de `packages/adapters` ni de `apps/*`.
- Validá con Zod en cada borde (HTTP, jobs, variables de entorno). Los tipos salen de los esquemas de `packages/contracts`.
- Los errores de dominio son clases tipadas con `code`; nada de `throw "string"`.
- Front: Scope Rule. Lo que usa una sola ruta vive en esa ruta; `shared/` solo para dos o más.
- Next.js no accede a la base: todo pasa por la API.

## Seguridad (ver §8 del maestro)
- Todo repositorio recibe `workspaceId` primero, y sale de la sesión o del token, nunca del request.
- Nunca loguees, devuelvas ni guardes en eventos una API key o un secreto.
- Nunca leas keys de proveedores desde variables de entorno; pasalas explícitas por ejecución.
- Nada de `fetch` a URLs del usuario fuera del cliente HTTP protegido contra SSRF.
- Cada endpoint nuevo trae su test cross-tenant.

## Tests
- Test primero cuando hay un resultado esperado claro: rojo, verde, refactor.
- Unit con Vitest al lado del archivo (`*.test.ts`). Integración con Testcontainers (Postgres real). E2E con Playwright.
- Para modelos, usá el proveedor faux de `pi-ai`; nunca llames a un proveedor real en CI.
- Un bug se arregla con un test que lo reproduce primero.

## Dependencias
- Antes de agregar una dependencia, justificá en el PR por qué no alcanza lo que ya hay.
- Versiones exactas para `@earendil-works/*`.

## Definición de terminado de un PR
- Typecheck, lint, tests y build en verde en el CI. GGA pasa.
- Cumple los criterios de aceptación del WP y del requisito de Notion vinculado.
- Sin TODOs nuevos salvo `TODO(decision)` vinculados a §16.
- `odd/tasks/<wp>.md` actualizado con la evidencia.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
