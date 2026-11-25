# Demo 2 — "Mi día"

Feature document for the second demo. `main` starts at `307b556`, with Demo 1
complete and CI green (including the browser suite). Each task quotes the master's
acceptance criterion; where a task depends on an ADR that already exists, it says so.

## Specs

**S1 — WP-40, framework de herramientas y aprobaciones (REQ-22).** «Puerto
`ToolRuntime`, registro, `tool_call`, aprobaciones con vencimiento, tarjeta de
aprobación en el chat y bandeja. *Acepta:* una herramienta que requiere aprobación
pausa la ejecución, aprobar la retoma y rechazar le devuelve al modelo un resultado
"denegado".»

**S2 — WP-50, segundo plano con pg-boss (riesgo alto).** «Puerto `JobQueue` con
pg-boss, jobs `run.execute` y `run.resume` con `singletonKey`, `lease_until` en
`run` para no correr dos veces la misma ejecución, reintentos sin repetir efectos,
límite de concurrencia por workspace y `apps/worker` con `work()`. *Acepta:* matar
el worker a mitad de una ejecución y volver a arrancarlo no duplica herramientas ya
ejecutadas, y la ejecución sigue desde su último `checkpoint`; los reintentos
ocurren solo ante errores transitorios.»

**S3 — WP-51, tareas programadas y el tick.** «Caso de uso `tick(now)` de §5, ABM
de tareas con zona horaria, ejecutar ahora y pantalla con historial. `apps/worker`
lo dispara cada minuto con `boss.schedule`. *Acepta:* con un reloj falso, avanzar el
tiempo genera exactamente una ejecución por vencimiento aunque el tick se dispare
dos veces; deshabilitar la tarea las detiene; el próximo horario respeta la zona
horaria y los cambios de horario de verano.»

**S4 — WP-53, integración con Google (riesgo alto).** Solo `calendar.readonly`.
La app de Google queda **publicada sin verificar** (ADR-0008): nunca en estado
Testing, porque ahí el refresh token vence a los 7 días y la tarea diaria se rompe
cada semana.

**S5 — WP-54, canales de entrega (riesgo alto).** Email con `Mailer` y WhatsApp por
la cuenta de una **empresa ya verificada** (ADR-0009), no por una cuenta propia de
Meta. Fuera de la ventana de 24 horas se usa la plantilla `resumen_listo`; dentro,
texto libre. Webhook con firma; un webhook con firma inválida da 401.

**S6 — WP-55, grupos de agentes: modelo y constructor.** Depende de WP-20 y WP-07.

**S7 — WP-56, motor de orquestación (riesgo alto).** Depende de WP-30, WP-40, WP-50
y WP-55. El coordinador delega; el presupuesto y la profundidad de delegación son
nuestros.

**S8 — WP-57, plantilla "Mi día" de punta a punta.** Depende de WP-51, WP-53, WP-54
y WP-56. Grupo plantilla con coordinador "Jefe de agenda" y tres miembros: "Lector
de calendario", "Priorizador" y "Redactor". Tarea programada de lunes a viernes a
las 7:30 en la zona del usuario, con entrega por email y WhatsApp.

**S9 — WP-41, búsqueda web (opcional, REQ-23).** Brave y Tavily con la key del
usuario. Puede esperar: no bloquea la Demo 2.

**S10 — La Demo 2 completa.** «Ale conecta su Google, agrega y verifica su email,
crea el grupo "Mi día", lo ejecuta y ve en vivo cómo el coordinador delega, recibe
el email con las tareas del día y deja la tarea programada para las mañanas.»

## Tasks

| # | Tarea | Specs | Ruta | Commit |
| --- | --- | --- | --- | --- |
| T1 | Contratos de herramientas: `tool_call`, aprobación con vencimiento, bandeja | S1 | `packages/contracts/src/**` | |
| T2 | Puerto `ToolRuntime`, registro y pausa por aprobación en el motor | S1 | `packages/core/src/**`, `packages/adapters/src/**` | |
| T3 | Rutas de aprobación y tarjeta en el chat con bandeja | S1 | `apps/api/src/**`, `apps/web/src/app/(app)/chat/**` | |
| T4 | `JobQueue` con pg-boss, `run.execute` y `run.resume`, `apps/worker` | S2 | `packages/core/src/ports/**`, `packages/adapters/src/**`, `apps/worker/**` | |
| T5 | `tick(now)` con reloj falso, ABM de tareas y zona horaria | S3 | `packages/core/src/usecases/**`, `apps/web/src/app/(app)/schedules/**` | |
| T6 | Google: OAuth, `calendar.readonly`, verificación de canal | S4 | `packages/adapters/src/**`, `apps/api/src/**` | |
| T7 | `Mailer` y WhatsApp por BSP, webhook firmado, idempotencia | S5 | `packages/adapters/src/**`, `apps/worker/**` | |
| T8 | Grupos: modelo, constructor y versiones | S6 | `packages/contracts/src/**`, `packages/core/src/**`, `apps/web/src/app/(app)/groups/**` | |
| T9 | Orquestación del coordinador con presupuesto y profundidad | S7 | `packages/core/src/usecases/**` | |
| T10 | Plantilla "Mi día" sembrada y recorrida de punta a punta | S8 | `packages/db/src/**`, `tests/e2e/**` | |

Orden por dependencia: T1 → T2 → T3, después T4 → T5, y en paralelo T6 y T7;
T8 → T9 → T10 al final. S9 (búsqueda web) queda fuera hasta que sobre tiempo.

## Log

**L1 — pedido del dueño, textual:** «voy a hacer compact, guarda lo necesario. Luego
del compact continuamos con demo 2»

**L2 — alcance, del maestro §14:** «Demo 2, "Mi día": además, WP-40 (framework y
aprobaciones), 41 (opcional), 50, 51, 53 (solo `calendar.readonly`), 54 (email;
WhatsApp si Q10 ya está resuelta), 55, 56 y 57. `MW_FEATURES=chat,tools,schedules,groups,google,email`.»

**L3 — prerrequisitos que el maestro pide antes de la Demo 2 y su estado:**

- Dominio propio (Q1) para Google y para el remitente verificado de Resend. **Falta.**
  El dueño decidió tenerlo cuando la app esté lista. Para probar en local, Google
  acepta `http://localhost` como redirect URI, así que T6 se puede construir y probar
  con los dos usuarios reales sin dominio; lo que no se puede es salir a internet.
- Ale cargado como usuario de prueba en Google (Q9). **Resuelto por ADR-0008:** la app
  va publicada sin verificar, con tope de 100 usuarios y pantalla de advertencia; no
  hace falta cargar usuarios de prueba ni verificar nada.
- VPS para el deploy (Q4). **No bloquea la Demo 2**: la demo corre en local.
