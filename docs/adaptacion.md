# Adaptación del código previo

> Auditoría WP-A0 — 29 de octubre de 2026. Fuente: `MAESTRO_PLATAFORMA.md` v3.0 y ADR-0003.
>
> **Estado:** pendiente de aprobación de Luca. Esta auditoría no cambia código de producto.

## Método y límites

Se revisaron los archivos versionados del corte `d74b1b5` en la rama `wp-a0-audit`, las tareas ODD existentes y el trabajo WP-06 presente sin commit en el worktree primario. La decisión `rehacer` solo se usa ante una violación demostrada de §8 o cuando adaptar cuesta más que reescribir; ninguna pieza auditada llega a ese umbral todavía.

Los comandos `pnpm typecheck`, `pnpm lint` y `pnpm test` se ejecutaron el 29 de octubre de 2026 sobre el worktree primario, que incluye el WP-06 sin commit: los tres terminaron correctamente. Turbo informó advertencias no bloqueantes porque `test` declara `coverage/**` como output sin producirlo. Los chequeos de D22 siguen sin línea base: `dependency-cruiser`, `knip` y `type-coverage` no están instalados ni configurados, por lo que no se inventan resultados.

## Riesgos de seguridad primero

| Prioridad | Hallazgo | Evidencia | Acción y WP |
| --- | --- | --- | --- |
| Alta | WP-06 está incompleto: falta integrar la persistencia/reenvoltura de DEK y cerrar la verificación independiente. | `odd/tasks/wp-06.md`, `packages/adapters/src/envelope.ts` en el worktree primario. | Terminar WP-06 sin reiniciarlo; prueba de rotación y revisión independiente. |
| Alta | No hay evidencia de una bóveda operativa ni de pruebas de que secretos no aparezcan en logs, eventos o tablas. | No existen rutas, repositorios ni pruebas WP-10 de credenciales. | Construir WP-10 como rebanada de referencia; incluye S2 y S4. |
| Media | No hay evidencia de cliente HTTP con defensas SSRF, ni de MCP/sandbox/aprobaciones. | No hay adaptadores de herramientas en el corte auditado. | Implementar en WP-40 a WP-44; no habilitar esas funciones antes. |
| Media | La resolución de workspace existe en auth, pero los tests cross-tenant por endpoint no están demostrados. | `apps/api/src/auth.ts`; no hay repositorios o endpoints de producto correspondientes. | Cubrir cada endpoint en WP-10 y posteriores. |
| Media | No se verificó rate limiting explícito de autenticación. | `apps/api/src/auth.ts`. | Confirmar configuración de Better Auth en WP-03. |

## Matriz de paquetes y apps

| Pieza | Estado actual | Decisión | Acción de adaptación |
| --- | --- | --- | --- |
| `apps/web` | Shell autenticado, rutas vacías, i18n, selector de tema y `/dev/ui`. | Adaptar | Agregar `MW_FEATURES`, completar estados y aceptar WP-04 contra v3. |
| `apps/api` | Hono, health/ready, Better Auth y SMTP; composición directa en `src/index.ts`. | Adaptar | Mover la composición a `createContainer`, reemplazar SMTP por el puerto `Mailer` cuando corresponda y mantener rutas delgadas. |
| `apps/worker` | Shell con heartbeat y apagado básico. | Adaptar | Sustituirlo por consumidor pg-boss y tick; el punto de entrada usará el contenedor. |
| `packages/config` | Base TypeScript compartida. | Conservar | Completar solo si WP-00 detecta configuración faltante. |
| `packages/core` | Cascarón con una prueba. | Adaptar | Crear dominio, puertos y casos de uso conforme se abran los WP. |
| `packages/db` | Esquema, migraciones, seed y ping. | Adaptar | Añadir campos de `run`, migraciones aditivas y pruebas reales con `DATABASE_URL_TEST`. |
| `packages/ui` | Tokens y componentes táctiles con pruebas unitarias. | Adaptar | Completar verificación de navegador, maquetas y requisitos WP-07. |
| `packages/adapters` | WP-06 sin commit: cifrado envolvente y bloqueo de variables de proveedor. | Adaptar | Terminar WP-06; después alojar repositorios, gateway, cola, mail y `createContainer`. |
| `infra` | Compose de desarrollo con Postgres y Caddy. | Adaptar | Agregar producción/demo, migración, rollback y separación de entornos en WP-08/WP-70. |
| CI y calidad | No hay `.github/workflows/ci.yml`, baseline ni herramientas D22. | Adaptar | Crear quality baseline en WP-00 y CI en WP-05. |

## Matriz de paquetes de trabajo

| WP | Estado | Evidencia | Falta para v3 | Decisión |
| --- | --- | --- | --- | --- |
| A0 | En curso | Esta auditoría. | Aprobación de Luca. | Adaptar |
| 00 | Parcial | pnpm, Turbo, Biome, TS, Vitest, Playwright y configuración compartida. | D22, `quality-baseline.json`, estructura/container, AGENTS v3, licencia y limpieza de Vercel/MW_TARGET. | Adaptar |
| 01 | Parcial | API, web, worker, Postgres y Caddy locales. | Validar topología y `/readyz` final. | Adaptar |
| 02 | Parcial | Drizzle, migraciones, seed y esquema. | Pruebas contra Postgres real; `DATABASE_URL_TEST`; campos `run` v3. | Adaptar |
| 03 | Parcial | Better Auth, organización/workspace y pantallas de auth. | E2E y aceptación v3 completa; revisar rate limit y mail. | Adaptar |
| 04 | Parcial | Shell responsivo, navegación, tema, mensajes y Playwright previo. | `MW_FEATURES`, mosaico y aceptación v3. | Adaptar |
| 05 | No existe | Sin task o CI observables. | CI, calidad D22 y línea base. | Adaptar |
| 06 | Parcial, en curso | Cifrado/validación de entorno sin commit y task existente. | Persistencia/rotación completa, pruebas y revisión independiente. | Adaptar |
| 07 | Parcial | Tokens, componentes y `/dev/ui`; pruebas unitarias. | Navegador/axe, comparación con maquetas y cierre. | Adaptar |
| 08 | No existe | Sin infraestructura de demo VPS. | Compose demo, deploy, smoke test y rollback. | Adaptar |
| 10 | No existe | Esquema de credencial y base de cifrado solamente. | Bóveda end-to-end, S2/S4, E2E y aprobación de Luca. | Adaptar |
| 11–14 | No existe | Sin gateway/modelos productivos. | Implementar después de WP-10 según dependencias. | Adaptar |
| 20–21 | No existe | Solo tablas de agente/versión. | Implementar después de WP-10. | Adaptar |
| 30–35 | No existe | Tablas base, sin executor ni API pública. | Implementar después de WP-20/11; conservar esquema compatible. | Adaptar |
| 40–46 | No existe | Sin framework de herramientas. | Implementar en el orden del maestro; no habilitar antes. | Adaptar |
| 50–57 | No existe | Sin pg-boss, tick, grupos operativos, Google ni entregas. | Implementar según dependencias v3. | Adaptar |
| 60–63 | No existe | Sin dashboard, onboarding completo o pulido final. | Implementar después de los fundamentos. | Adaptar |
| 70–71 | No existe | Sin producción/demo final ni legales. | Implementar después de WP-08 y el resto del MVP. | Adaptar |

## Orden operativo

1. Luca aprueba esta auditoría.
2. WP-00 instala calidad, línea base y estructura v3; WP-06 continúa en paralelo sin ser reabierto.
3. WP-01, WP-02, WP-03, WP-05 y WP-07 avanzan según sus dependencias.
4. WP-10 se completa y requiere aprobación explícita de Luca antes de extender producto.
5. Los WP posteriores siguen §15 y sus dependencias; las funciones no implementadas quedan apagadas.

## Pendiente de aprobación

Luca debe aprobar la matriz y el orden anterior. Tras esa aprobación, cada fila se actualiza con la evidencia y los cambios solo bajan `quality-baseline.json`.
