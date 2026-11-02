# Lo que corre el CI

`.github/workflows/ci.yml` corre en cada push y en cada PR, contra un Postgres real
(servicio de Actions, base `middleware_test` creada desde `infra/postgres/init-test-database.sql`
y migrada antes de la suite).

| Paso | Qué protege |
| --- | --- |
| `pnpm typecheck` | Que los tipos cierren en todo el monorepo. |
| `pnpm lint` | Biome, con cualquier warning como falla. |
| `pnpm test` | Unitarias e integración. Sin `DATABASE_URL_TEST` las suites de integración fallan fuerte en vez de saltearse en silencio. |
| `pnpm arch` | dependency-cruiser: las reglas de §2 que no se ven en un diff. |
| `pnpm knip` | Código y dependencias que nadie usa. |
| `pnpm build` (web) | Que el front compile. |

## Las reglas de arquitectura

`.dependency-cruiser.cjs` verifica, entre otras:

- `packages/core` no importa adaptadores ni apps: es la capa interna.
- `apps/web` no toca `packages/db` ni `packages/adapters`: todo pasa por la API.
- `packages/contracts` no depende de los otros paquetes: es el vocabulario compartido.
- Sin ciclos.

Nada de esto lo detecta una revisión de diff: un solo import rompe la regla y compila igual.

## type-coverage: bloqueado, no olvidado

`type-coverage` no puede correr todavía. Necesita la API del compilador de TypeScript
(`ts.createProgram`) y el proyecto usa TypeScript 7, que ya no la expone. Su propio
upstream lo dice: hace falta TypeScript 6 para el core de la herramienta, y el override
por peer no alcanza porque `type-coverage-core` resuelve `typescript` como peer.

El script `pnpm types:strict` queda disponible para el día que el upstream soporte
TypeScript 7. Hasta entonces el gate de tipos es `pnpm typecheck` con `strict`,
`noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`, más la prohibición de `any`
en la revisión.

`TODO(decision)`: retomar `type-coverage` cuando `type-coverage-core` publique soporte
para TypeScript 7, o evaluar bajarlo a TypeScript 6 (§16).
