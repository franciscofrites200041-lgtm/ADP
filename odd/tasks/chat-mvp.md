# Feature: chat usable (WP-30 a WP-33)

Hito 4 del maestro. Objetivo: que un usuario pueda hablar con un agente y ver la
respuesta llegar en vivo. Sin esto el producto configura pero no usa.

Alcance: WP-30 (motor), WP-31 (streaming), WP-32 (historial), WP-33 (errores).
Fuera de alcance: herramientas (WP-40), segundo plano con pg-boss (WP-50), grupos.

## Specs

Las specs citan `MAESTRO_PLATAFORMA.md`; lo entrecomillado es textual del maestro y
no se resume.

**S1 — Iniciar y transmitir (D15, §5, §10).** «`POST /api/runs` valida el input, crea
la fila `run` (`queued`) y su mensaje de usuario, y **responde con un stream SSE**
(D15). El primer evento es `run.started` con el `runId`.» Un solo request: no hay
`POST` que devuelva un id para después suscribirse.

**S2 — La ejecución sobrevive al cliente.** «La ejecución arranca dentro de
`BackgroundTasks` (una promesa registrada en el proceso, que espera antes de
apagarse), para que **siga aunque el cliente se desconecte**. Mientras corre, renueva
`lease_until` cada 30 s.»

**S3 — Qué hace el ejecutor.** «`RunExecutor`: carga la versión del agente; pide al
`CredentialVault` la key descifrada, solo en memoria; arma un `Models` de `pi-ai`
**nuevo para esta ejecución**, con solo el proveedor necesario, y pasa la key de forma
explícita; crea el `Agent` de `pi-agent-core` con instrucciones, modelo, parámetros,
historial y herramientas.»

**S4 — Doble destino de los eventos.** «Cada evento del agente se traduce al protocolo
de §10 y va a dos lugares: al **`LiveEventBus` en memoria** del proceso, que alimenta
el stream del request; al **`RunEventStore`** en la base, con un `seq` creciente. Los
`message.delta` se **agrupan cada 250 ms** en una sola fila para no escribir un
registro por token.»

**S5 — Checkpoint por turno.** «Al terminar cada turno se guarda el `checkpoint` y se
suma `turns_completed`.»

**S6 — Reconexión sin depender del proceso.** «Para reconectarse, el cliente pide
`GET /api/runs/:id/events` con `Last-Event-ID`. Ese endpoint lee lo guardado desde ese
`seq` y después **consulta la base cada 500 ms** hasta que la ejecución termina. No
depende de estar en el mismo proceso.»

**S7 — Cierre.** «Al terminar se guardan el mensaje final, los `usage_record` y el
estado (`succeeded`, `failed` o `cancelled`).»

**S8 — Protocolo de eventos (§10).** «Cada evento lleva `id` igual a `seq`, `event`
igual al tipo y `data` en JSON. Los tipos se definen en `packages/contracts/events.ts`
y el front los consume tipados.» Tipos: `run.started`, `message.delta`,
`message.completed`, `thinking.delta`, `tool.started`, `tool.completed`,
`approval.requested`, `approval.resolved`, `usage`, `delegation.started`,
`delegation.completed`, `child.event`, `delivery.updated`, `run.completed`,
`run.failed`, `run.cancelled`. Para este alcance se implementan los de agente suelto;
los de grupos y entregas quedan declarados y sin emitir.

**S9 — Errores de proveedor (§10).** «`ModelGateway` traduce los errores de `pi-ai` a
estos códigos, con mensajes en español: `invalid_api_key`, `insufficient_quota`,
`rate_limited`, `model_not_found`, `context_too_long`, `provider_timeout`,
`provider_unavailable`, `content_filtered`, `tool_failed`, `run_timeout`,
`limit_reached`, `integration_needs_reauth`, `delivery_failed`, `unknown`.»

**S10 — Límites (§5).** Duración de una ejecución interactiva 10 min; turnos de modelo
por ejecución 25; duración de una herramienta 60 s; ejecuciones simultáneas por
workspace 5.

**S11 — Conversaciones e historial (§10).** «`GET/POST /api/conversations`,
`PATCH/DELETE /api/conversations/:id`, `GET /api/conversations/:id/messages` |
Conversaciones e historial paginado.» Y `POST /api/runs/:id/cancel`, `GET /api/runs`.

**S12 — Seguridad (§8).** La key se descifra solo en memoria, por ejecución; nunca se
loguea, nunca se devuelve y nunca aparece en un evento. Todo repositorio recibe
`workspaceId` primero y sale de la sesión. Cada endpoint nuevo trae su test
cross-tenant.

## Tasks

| # | Tarea | Specs | Ruta | Commit |
| --- | --- | --- | --- | --- |
| T1 | Contratos del motor: eventos SSE, ejecuciones, conversaciones y mensajes | S8, S11 | `packages/contracts/src` | |
| T2 | Migración aditiva: `turns_completed`, `checkpoint`, `lease_until` en `run` | S5, S10 | `packages/db/drizzle` | |
| T3 | Puertos: `RunEventStore`, `LiveEventBus`, `BackgroundTasks` y repos de ejecución | S2, S4 | `packages/core/src/ports` | |
| T4 | Casos de uso `startRun` y `executeRun`: turnos, checkpoint, límites y cierre | S3, S5, S7, S10 | `packages/core/src/usecases/runs.ts` | |
| T5 | Adaptadores: repos Drizzle, event store con `seq`, bus en memoria, background tasks | S4 | `packages/adapters/src` | |
| T6 | `POST /api/runs` que responde con el stream SSE (D15) | S1 | `apps/api/src/run-routes.ts` | |
| T7 | `GET /api/runs/:id/events` con `Last-Event-ID`, cancelación y listado | S6, S11 | `apps/api/src/run-routes.ts` | |
| T8 | Verificación independiente contra §8 y §13 (riesgo alto) | — | — | `bef234f` |
| T9 | Pantalla de chat: enviar y ver la respuesta llegar; recargar a mitad de respuesta sin perder texto | S1, S6, S9, S11 | `apps/web/src/app/(app)/chat/**` | |

Decisión resuelta: se adopta `@earendil-works/pi-agent-core@1.1.0`, versión exacta.
Verificado contra el registro: existe y declara `@earendil-works/pi-ai: ^1.1.0`,
la misma línea que el repo tiene pinneada, así que no fuerza un salto de `pi-ai`.
Aporta el bucle de agente con ejecución de herramientas y streaming de eventos;
escribirlo a mano sería reimplementar lo que el maestro ya eligió. El
`checkpoint`, el `seq` y los límites siguen siendo nuestros.

## Log

**L1** — Pedido del dueño, textual: «quiero que continuemos con todo el spec, en que
parte vamos? que nos falta para un mvp mas o menos usable». Elegido el corte: «WP-30 a
WP-33: chat usable (Demo 1)».
