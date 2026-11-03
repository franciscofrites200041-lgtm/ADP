# Llegar hasta WP-21

Alcance acordado: cerrar WP-12, WP-13, WP-14, WP-20 y WP-21 del maestro vigente
(`MAESTRO_PLATAFORMA.md`). **No existe WP-22**: la numeración salta de WP-21 a WP-30,
así que "hasta WP-21" es el último escalón contiguo antes de WP-30 (motor de ejecución).

## Specs

Las aceptaciones son texto literal del maestro, no un resumen.

- **S1 (WP-12, REQ-9).** "una key válida queda `valid`; una inválida, `invalid` con
  mensaje claro (probado con un servidor HTTP falso)."
- **S2 (WP-13, REQ-10).** "los modelos vienen del descubrimiento de `pi-ai`, sin lista
  fija, con cache de 1 h."
- **S3 (WP-14, REQ-11, Could).** "`base_url` pasa la protección SSRF; funciona contra un
  servidor compatible falso."
- **S4 (WP-20, REQ-12/13/14/16).** "editar crea una versión nueva; restaurar crea otra
  versión igual a la elegida; no se puede elegir una credencial de otro workspace."
- **S5 (WP-21, REQ-15).** "crear desde una plantilla deja el agente listo para chatear
  con solo elegir la credencial."

Restricciones permanentes que aplican a todas: §13.2 contratos primero cuando el WP toca
varias capas; máximo ~400 líneas por PR; cada endpoint nuevo trae su test cross-tenant;
ningún secreto en logs, eventos, errores ni respuestas; GGA pasa en cada commit.

## Tasks

| ID | Spec | Qué | Ruta | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1 | Contratos de "probar conexión": resultado `valid`/`invalid` con código, sin texto de UI | contracts | **hecho** `a9da497` (39 tests; el contrato rechaza `invalid` sin código y rechaza texto de UI) |
| T2 | S1 | Caso de uso `testConnection` en core con puerto de prueba de credencial | core | pendiente |
| T3 | S1 | Sonda real contra el proveedor en adapters, testeada con servidor HTTP falso (válida e inválida) | adapters | pendiente |
| T4 | S1 | `POST /api/credentials/:id/test` con sesión, workspace y test cross-tenant | api | pendiente |
| T5 | S1 | Estado de la credencial en la pantalla de Proveedores, con React Testing Library instalado en este test | web | pendiente |
| T6 | S2 | Contratos y caso de uso de listado de modelos con cache de 1 h | contracts + core | pendiente |
| T7 | S2 | Descubrimiento por `pi-ai` en el gateway, sin lista fija, con test de cache | adapters | pendiente |
| T8 | S2 | Endpoint de modelos y selector en el editor | api + web | pendiente |
| T9 | S3 | Cliente HTTP protegido contra SSRF (decisión: WP-14 es Could; se evalúa después de S2) | adapters | pendiente |
| T10 | S4 | Modelo de agentes y versiones inmutables, contratos primero | contracts + db | pendiente |
| T11 | S4 | Casos de uso: crear, editar (versión nueva), duplicar, restaurar | core | pendiente |
| T12 | S4 | Rutas de agentes y versiones con test cross-tenant de credencial ajena | api | pendiente |
| T13 | S4 | Editor de agentes según §11 | web | pendiente |
| T14 | S5 | Seed de las 6 plantillas: soporte, redacción, investigación web, analista de datos con código, integrador HTTP y resumen diario programado | db + core | pendiente |
| T15 | S5 | Crear agente desde plantilla, listo para chatear eligiendo credencial | core + web | pendiente |

## Log

- **L1** (pedido del usuario, literal): "continua,  quiero llegar a WP - 22"
- **L2** (aclaración): el maestro no define WP-22; el usuario eligió "Hasta WP-21:
  agentes + plantillas".
- **L3** (estado de partida): WP-06, WP-10 y WP-11 cerrados; CI verde con
  dependency-cruiser y knip; `type-coverage` bloqueado por TypeScript 7.

- **L4** (T2 en curso, sin commit todavía): core ya tiene el caso de uso y el puerto
  `CredentialProbe`, con 13 tests verdes. El árbol **no typechequea** porque
  `packages/adapters/src/credential-repo.ts` todavía no implementa `findSealed` ni
  `setStatus`, y `createContainer` todavía no inyecta `credentialProbe`. Próximo paso
  exacto: implementar esos dos métodos en el adaptador y la sonda real (listar modelos
  con pi-ai como prueba de conexión), recién entonces commitear T2+T3 juntas.

- **L5** (WP-12 cerrado): T1 `e05d260`+`a9da497` (contratos), T2/T3 `c69fda8` (caso de
  uso, puerto `CredentialProbe`, sonda HTTP con servidor falso), T4 `8b56320` (ruta +
  cross-tenant), T5 `e91ad61` (badge, RTL instalado, `apps/web/vitest.config.ts`).
- **L6** (WP-13 cerrado): `dca92df`. `GET /api/credentials/:id/models` con caché de 1 h
  en memoria (puerto `ModelCache`), autorización antes de la caché, y sin seguir la
  `baseUrl` del usuario (eso es WP-14).
- **L7** (decisión de secuencia): WP-14 es *Could* del maestro y **no** bloquea WP-20 ni
  WP-21 (WP-20 depende solo de WP-10). Se pospone para poder llegar a WP-21, y queda
  registrado como la deuda más grande abierta: el cliente SSRF.

- **L8** (WP-20 API cerrado): `5991f5c`. Contratos `26e7c99`; dominio, puerto y casos de
  uso en core; `agent-repo.ts` con jsonb validado por Zod y alta atómica en transacción;
  ocho rutas con sesión y cross-tenant; migración `0004` (`credential_id` ON DELETE SET
  NULL). Cinco rondas de GGA destaparon: agente huérfano en un rechazo cross-tenant,
  escrituras no atómicas, jsonb casteado, y `AGENTS.md` contradiciendo al ADR-0006.
- **L9** (decisiones de proceso): `.gga` ahora revisa los tests (antes los excluía, así
  que la objeción "faltan tests" era imposible de satisfacer). Los casos cross-tenant
  viven solo en integración contra Postgres real, nunca con dobles en memoria.

- **L10** (WP-21 cerrado): seed de las seis plantillas con ids fijos
  (`packages/db/src/seed-agent-templates.ts`), `seedDatabase`, `GET
  /api/agent-templates` y el selector de plantilla en la pantalla de agentes.
  Evidencia: `agent-templates.integration.test.ts` (idempotencia del seed,
  sesión obligatoria, catálogo global sin ids de workspace, y alta desde plantilla
  eligiendo solo la credencial) y `seed.test.ts` reescrito porque fijaba el
  registro vacío.
- **L11** (estándar): `AGENTS.md` ahora declara la única excepción a
  "todo repositorio recibe `workspaceId` primero": el catálogo global de plantillas.
- **L12** (Q7 sigue abierta): las seis plantillas están escritas con contenido
  razonable en español rioplatense, pero el texto final es decisión de producto
  (responsable Ale, §16 del maestro).
