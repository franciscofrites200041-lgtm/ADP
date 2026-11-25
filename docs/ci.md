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
| `pnpm exec playwright test` | Un navegador real: abre todas las pantallas y corre los flujos. Es lo único que ve un error boundary, un componente que revienta al renderizar o una recarga que pierde el texto. |

## Por qué hay un smoke de navegador

Tres defectos llegaron a `main` con typecheck, lint y todos los tests en verde: una
pantalla que caía en su error boundary por un error de React, un formulario que le
pasaba `children` a un `input`, y una pantalla de chat que perdía la respuesta al
recargar porque el `run.started` no dejaba el agente en la dirección. Ninguno era
visible sin abrir la página.

`tests/e2e/smoke.spec.ts` abre cada ruta del shell y falla si aparece el texto del
error boundary, si falta el título de la pantalla o si la consola registra un
error. La aserción está viva: con una espera equivocada falla, que es la prueba
de que no es decorativa.

Nota de esta máquina: `next dev` no hidrata y `next start` sirve un build
congelado. Un cambio de UI exige reconstruir antes de correr el e2e, o el
navegador sigue viendo el build anterior y el test pasa sin haber visto nada.

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
