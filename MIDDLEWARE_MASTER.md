# Middleware: documento maestro de construcción

> Versión 1.1, 9 de octubre de 2026 (agrega sistema de diseño, grupos de agentes, integración con Google y canales de entrega). Autores: Luca (desarrollo) y Ale (comercial).
> Este documento es la fuente de verdad para la orquestación de agentes que construye el MVP.
> "Middleware" es un nombre provisorio: usalo en el código como `middleware` / `mw` y dejalo fácil de cambiar en la UI (una sola constante `APP_NAME`).

---

## 0. Cómo usar este documento (leer primero, orquestador)

1. **Leé el documento completo antes de escribir código.** Las secciones 3 (decisiones cerradas) y 8 (seguridad) no se negocian.
2. **Primer trabajo:** preparar el entorno de construcción (§12) y crear `AGENTS.md` en la raíz del repo copiando el bloque de §13. Ese archivo es el que revisa GGA en cada commit.
3. **El trabajo se hace por paquetes (WP)** definidos en §15. Cada WP es una rama, un `odd/tasks/<wp-id>.md` y un pull request. Respetá las dependencias; los WP sin dependencia entre sí pueden ir en paralelo con subagentes, siempre que editen carpetas distintas.
4. **Una decisión cerrada no se cambia en silencio.** Si encontrás un motivo técnico real para cambiarla, escribí un ADR en `docs/adr/NNNN-titulo.md` con el problema, la propuesta y las alternativas. Después frená y pedile aprobación a Luca.
5. **Antes de inventar, preguntá.** Lo que está en §16 (preguntas abiertas) no lo decidas vos: usá el valor por defecto que se indica ahí y dejá un `TODO(decision)` visible.
6. **Las versiones de §4 son las vigentes al 9/10/2026.** Antes de usar una API, confirmá la sintaxis actual con Context7 o con la documentación oficial. Las skills de Gentleman que se instalan son de versiones anteriores (por ejemplo, Next.js 15 y AI SDK 5): usalas por sus convenciones, no por su API exacta.
7. **Guardá en Engram** (proyecto `middleware`) cada decisión, descubrimiento o convención nueva, con `topic_key` estable: `architecture/*`, `decisions/*`, `conventions/*`, `gotchas/*`.

---

## 1. Producto

### Qué es
Una web app multiusuario para crear agentes de IA a medida. Cada usuario conecta sus **propias API keys** de varios proveedores (OpenAI, Anthropic, Google, xAI, OpenRouter y endpoints compatibles con OpenAI). Después crea agentes con instrucciones, modelo, parámetros y herramientas, y los usa desde un chat, desde una API propia o en segundo plano con tareas programadas. Es parecido a los agentes que se arman en la app de Grok, pero sin atarse a un proveedor y con más control fino.

### Para quién
Pendiente de definir por Ale (propuesta de valor y público objetivo). Mientras tanto, el usuario tipo es una persona técnica o semitécnica que ya paga APIs de modelos y quiere agentes reutilizables sin programarlos.

### Qué entra en el MVP
- Cuentas con login (email y contraseña, y Google), con un workspace por usuario.
- Gestión de API keys por proveedor, cifradas, con prueba de conexión y listado de modelos.
- Constructor de agentes: instrucciones, proveedor, modelo, parámetros, herramientas y versionado.
- Chat con streaming, historial y manejo claro de errores.
- API pública por agente con tokens propios.
- Herramientas: búsqueda web, llamadas HTTP, servidores MCP remotos y ejecución de código en sandbox.
- Ejecuciones en segundo plano y tareas programadas (cron), con aprobaciones para acciones sensibles.
- **Grupos de agentes:** un coordinador que delega en los agentes del grupo y arma el resultado final. Cada workspace puede tener varios grupos, y cada grupo se ejecuta a demanda o con su tarea programada.
- **Integración con Google:** el usuario conecta su cuenta para que los agentes lean su calendario y envíen mails desde su Gmail.
- **Canales de entrega:** el resultado de un agente o de un grupo llega por **email** y por **WhatsApp**. Más canales después.
- Caso de uso guía (la demo del MVP): todos los días, el grupo "Mi día" revisa el calendario y manda por email y WhatsApp las tareas del día con sugerencias.
- Registro de tokens y costo por mensaje, y un dashboard de uso.
- Deploy en un VPS propio con Docker, backups y monitoreo.

### Qué queda afuera del MVP
- App mobile nativa.
- Equipos con invitaciones y roles. El modelo de datos ya los soporta (§7); la UI no.
- Marketplace público de agentes.
- Cobro y facturación dentro de la app.
- Servidores MCP locales por stdio (ver S6 en §8).
- Grupos dentro de grupos, y otros modos de orquestación (cadena de pasos o paralelo con combinación). El modelo de datos deja lugar para sumarlos.
- Leer o buscar en el Gmail del usuario: es un permiso restringido de Google que exige una auditoría de seguridad anual.
- Canales de entrega distintos de email y WhatsApp (Telegram, Slack, etc.).

### Principios
- Las keys son del usuario: nunca se exponen, nunca se loguean y nunca se usan para otra cosa.
- Agregar un proveedor nuevo tiene que ser barato.
- Si no es Must, no bloquea el lanzamiento.
- Verificar le gana a generar: cada regla pedida tiene un test.

---

## 2. Glosario del dominio

| Término | Significado |
| --- | --- |
| **Workspace** | Unidad de aislamiento. Todo dato de negocio pertenece a un workspace. En el MVP cada usuario tiene exactamente uno, creado al registrarse. Se implementa con la "organización" de Better Auth. |
| **Proveedor** | Un servicio de modelos (`openai`, `anthropic`, `google`, `xai`, `openrouter`, `openai-compatible`). El catálogo sale de `pi-ai`. |
| **Credencial** | Una API key de un proveedor, guardada cifrada, con un alias. Puede haber varias por proveedor. |
| **Agente** | Configuración con nombre. Su contenido vive en versiones inmutables. |
| **Versión de agente** | Instantánea inmutable de instrucciones, proveedor, modelo, credencial, parámetros y herramientas. Editar un agente crea una versión nueva. |
| **Conexión de herramienta** | Configuración reutilizable de una herramienta del workspace: un proveedor de búsqueda con su key, un endpoint HTTP o un servidor MCP. |
| **Conversación** | Hilo de mensajes entre un usuario y un agente. |
| **Ejecución (run)** | Una corrida del agente desde un input hasta su respuesta final. Puede venir del chat, de la API, de una tarea programada o de un disparo manual. |
| **Evento de ejecución** | Cada cosa que pasa durante una ejecución (texto parcial, herramienta llamada, aprobación pedida, etc.). Se persiste para poder reconectarse. |
| **Aprobación** | Pedido de confirmación humana antes de una herramienta con efectos (escribir, enviar, borrar). |
| **Tarea programada** | Una regla cron que crea ejecuciones de un agente con un input fijo. |
| **Token de API** | Credencial nuestra (`mw_live_…`) para usar un agente desde otra app. |
| **Registro de uso** | Tokens y costo de cada mensaje del modelo. |
| **Grupo de agentes** | Conjunto de agentes de un workspace con un objetivo común. Tiene un **coordinador** (un agente del workspace) y **miembros** (otros agentes, cada uno con una descripción de para qué sirve). |
| **Delegación** | Cuando el coordinador le pasa una tarea a un miembro. Cada delegación es una ejecución hija (`parent_run_id`) del miembro, con sus propias instrucciones, modelo, key y herramientas. |
| **Integración** | Una cuenta externa conectada por OAuth al workspace (en el MVP, Google) que habilita herramientas: leer el calendario y enviar mails. |
| **Canal de entrega** | Un destino verificado del usuario (su email, su número de WhatsApp) al que el sistema manda el resultado final de un agente o de un grupo. |
| **Entrega** | Un envío concreto de un resultado a un canal, con su estado (`pending`, `sent`, `delivered`, `failed`). |

---

## 3. Decisiones cerradas

| # | Tema | Decisión | Por qué | Descartado |
| --- | --- | --- | --- | --- |
| D1 | Lenguaje | **TypeScript full-stack**, modo estricto | Es el lenguaje de Pi, de Next.js y de las skills de Gentleman; un solo lenguaje para todo el equipo de agentes | Go en el back (librerías de agentes pobres), Python en el back (se aleja del ecosistema) |
| D2 | Motor de agentes | **Pi**: `@earendil-works/pi-ai` (proveedores), `pi-agent-core` (agente), `pi-mcp` (MCP), `pi-codemode` (sandbox JS) | API key explícita por request, costo por mensaje con precios de catálogo, proveedor de prueba "faux", y es la base que usa Gentleman en gentle-shell y gentle-dot | Vercel AI SDK 7 (no trae precios), Mastra (más pesado) |
| D3 | Arquitectura | **Monorepo** con `apps/web` (Next.js 16), `apps/api` (Hono) y `apps/worker` (pg-boss) | El streaming largo y las ejecuciones no deben vivir en funciones de Next.js | Solo Next.js, SPA con Vite |
| D4 | Hosting | **VPS propio con Docker Compose** y Caddy como proxy con HTTPS | Barato, sin límites de duración, Luca tiene experiencia en infra | Vercel (límites de tiempo), PaaS de contenedores |
| D5 | Datos | **PostgreSQL 18 + Drizzle ORM** | SQL tipado y liviano; una sola base para datos, sesiones y cola | Prisma 8 (todavía RC), SQLite |
| D6 | Auth | **Better Auth** con plugin de organizaciones, email y contraseña, y Google OAuth | Open source, vive en nuestra base | Clerk, Supabase Auth |
| D7 | Usuarios | **Un workspace por usuario** en el MVP; el esquema ya soporta equipos | Agregar equipos después sin migrar datos | Equipos desde el día uno, usuarios sueltos |
| D8 | UI | **shadcn/ui + Tailwind CSS 4**, React 19, TanStack Query, Zustand solo para estado de UI | Componentes propios en el repo, alineado con las skills de Gentleman | Mantine, HeroUI |
| D9 | Segundo plano | **pg-boss** sobre el mismo Postgres, con colas, reintentos y cron | Sin Redis; una sola pieza de infraestructura | BullMQ (necesita Redis), `pi-durable` (experimental y sin backend Postgres; reevaluar post-MVP) |
| D10 | Sandbox | **MVP: `pi-codemode`** (QuickJS en WebAssembly, en proceso, solo puede llamar herramientas inyectadas). **Opcional: `gondolin`** (micro-VM Linux) detrás de un flag | Gondolin necesita QEMU y, para rendir, `/dev/kvm` en el VPS, que muchos proveedores no tienen | Docker-in-Docker (riesgo de escape), servicios externos de sandbox |
| D11 | MCP | Solo **servidores remotos por Streamable HTTP** en el MVP, con OAuth cuando el servidor lo pida | Un servidor por stdio ejecutaría comandos arbitrarios en nuestro servidor | stdio |
| D12 | Construcción | **Claude Code + gentle-ai** (flujo ODD, revisión RDD, memoria Engram), **GGA** en cada commit, CI que bloquea merges | Es el entorno de Gentleman para agentes que construyen con evidencia | gentle-shell, OpenCode |
| D13 | Calidad | **TDD** cuando hay test ejecutable (rojo, verde, refactor), con GGA y CI obligatorios | Pedido explícito de Luca | Tests solo en lo crítico |
| D14 | Arquitectura de código | **Hexagonal en `packages/core`** (puertos y adaptadores) y **Scope Rule** en el front | Preferencia de Gentleman; el dominio no depende de Hono, Next ni Drizzle | Capas mezcladas |
| D15 | Streaming al navegador | **Server-Sent Events (SSE)** desde Hono, con reanudación por `Last-Event-ID` | Más simple que WebSocket y alcanza: el cliente manda por POST y recibe por SSE | WebSocket |
| D16 | Grupos de agentes | **Coordinador que delega**: el coordinador recibe una herramienta `delegate_<miembro>` por cada miembro; cada llamada es una ejecución hija del miembro. Un solo nivel (los miembros no delegan) | Es el patrón más flexible con un solo motor (§5); reusa todo lo de agentes sueltos | Cadena fija y paralelo con combinación (post-MVP), `pi-durable` (experimental) |
| D17 | Google | **Integración propia por OAuth** con permisos incrementales: `calendar.readonly` y `gmail.send` (ambos *sensibles*: piden verificación de la app, no auditoría CASA) | Es lo más simple para el usuario: un botón "Conectar Google" | MCP de terceros; `gmail.readonly` (restringido, requiere CASA anual) |
| D18 | Entrega de resultados | **El sistema entrega, no el modelo**: al terminar una ejecución, se manda el resultado final a los canales configurados. **Email** con nuestro proveedor transaccional y **WhatsApp** con WhatsApp Cloud API (plantilla *utility*) | Entrega confiable, con reintentos y estado, sin depender de que el modelo "se acuerde" de enviar | Que el modelo envíe con herramientas (sigue siendo posible, con aprobación) |
| D19 | Estilo visual | **Cálido y táctil** (§11.1): fondo crema, tarjetas beige muy redondeadas, un solo naranja rojizo, paneles marrón oscuro para los momentos importantes y conectores punteados para los flujos | Elegido por Luca a partir de su referencia; maquetas en `docs/design/mockups/` | Consola técnica, estudio cercano, señal audaz |

---

## 4. Stack y versiones (verificadas el 9/10/2026)

| Pieza | Paquete | Versión |
| --- | --- | --- |
| Runtime | Node.js | 24 LTS (las librerías de Pi piden ≥ 22.19) |
| Gestor | pnpm + Turborepo | pnpm 11, `turbo` 2.11 |
| Lenguaje | `typescript` | 7.0 |
| Lint y formato | `@biomejs/biome` | 2.5 |
| Web | `next` + `react` | 16.4 + 19.3 |
| Estilos | `tailwindcss` + `shadcn` (CLI) | 4.3 + 4.21 |
| Datos en cliente | `@tanstack/react-query` | 5.104 |
| Estado de UI | `zustand` | 5.0 |
| Validación | `zod` | 4.6 |
| API | `hono` + `@hono/node-server` | 4.13 + 2.1 |
| Auth | `better-auth` | 1.7 |
| ORM | `drizzle-orm` + `drizzle-kit` | 0.45 + 0.31 |
| Driver Postgres | `postgres` (postgres.js) | 3.4 |
| Cola y cron | `pg-boss` | 12.37 |
| Proveedores de IA | `@earendil-works/pi-ai` | 1.1 |
| Agente | `@earendil-works/pi-agent-core` | 1.1 |
| MCP | `@earendil-works/pi-mcp` | 1.1 |
| Sandbox JS | `@earendil-works/pi-codemode` | 1.1 |
| Sandbox VM (opcional) | `@earendil-works/gondolin` | 0.13 |
| Esquemas de herramientas | `typebox` | 1.3 (lo usa `pi-agent-core`) |
| Logs | `pino` | 10.4 |
| Errores (opcional) | `@sentry/node` | 11.6 |
| Tests | `vitest` + `@playwright/test` + `@testcontainers/postgresql` | 5.0 + 1.64 + 12.2 |
| Proxy | Caddy | 2.x (imagen oficial) |
| Base | PostgreSQL | 18 (imagen oficial) |

Fijá versiones exactas en `package.json` (sin `^` para las de Pi, que cambian rápido) y usá `pnpm-lock.yaml`. Las librerías de Pi se actualizan solo con un WP propio y tests verdes.

---

## 5. Arquitectura

### Vista general

```
                    Internet
                       │  HTTPS
                ┌──────▼──────┐
                │    Caddy    │  app.<dominio>
                └──┬───────┬──┘
        /*  (web)  │       │  /api/*  y  /v1/*
           ┌───────▼──┐ ┌──▼──────────────┐
           │ apps/web │ │    apps/api     │  Hono: REST + SSE + Better Auth
           │ Next 16  │ │  (RunExecutor   │  ejecuciones interactivas
           └──────────┘ │   interactivo)  │
                        └──┬───────────┬──┘
                           │           │ encola jobs
                    ┌──────▼─────┐  ┌──▼────────────┐
                    │ PostgreSQL │◄─┤  apps/worker  │  pg-boss: ejecuciones en
                    │  datos +   │  │ (RunExecutor  │  segundo plano y cron
                    │  pg-boss   │  │  en 2º plano) │
                    └────────────┘  └──┬────────────┘
                                       │
          Proveedores de modelos, búsqueda web, APIs HTTP y servidores MCP del usuario
```

- **Un solo dominio.** Caddy manda `/api/*` y `/v1/*` a Hono y el resto a Next.js. Así la cookie de sesión de Better Auth sirve para los dos sin CORS.
- **Next.js no habla con la base.** Toda lectura y escritura pasa por la API de Hono. Los Server Components llaman a la API reenviando la cookie.
- **`apps/api` y `apps/worker` comparten código** a través de `packages/core` y usan la misma imagen de Docker con distinto comando.

### Capas (hexagonal)

```
packages/core            dominio y casos de uso, sin dependencias de framework
  domain/                entidades, value objects y errores tipados
  ports/                 interfaces: AgentRepo, RunRepo, CredentialVault, ModelGateway,
                         ToolRuntime, EventBus, Clock, IdGen, JobQueue
  usecases/              createAgent, startRun, executeRun, approveToolCall, …
packages/adapters        implementaciones de los puertos
  db/                    repos con Drizzle
  pi/                    ModelGateway con pi-ai, agente con pi-agent-core
  tools/                 web-search, http, mcp (pi-mcp), codemode
  crypto/                CredentialVault con cifrado envolvente
  queue/                 JobQueue con pg-boss
apps/api, apps/worker    composición (inyección de dependencias), HTTP y jobs
```

Regla: `packages/core` no importa nada de `packages/adapters` ni de `apps/*`. Biome o un test de dependencias lo verifica.

### Cómo corre una ejecución interactiva (chat o API)

1. `POST /api/runs` valida el input, crea la fila `run` (`queued`) y su mensaje de usuario, y responde `{ runId }`.
2. El cliente abre `GET /api/runs/:id/events` (SSE).
3. `RunExecutor` (en `apps/api`):
   - carga la versión del agente;
   - pide al `CredentialVault` la key descifrada, solo en memoria;
   - arma un `Models` de `pi-ai` **nuevo para esta ejecución**, con solo el proveedor necesario, y pasa la key de forma explícita;
   - crea el `Agent` de `pi-agent-core` con instrucciones, modelo, parámetros, historial y herramientas.
4. Cada evento del agente se traduce al protocolo de §10, se guarda en `run_event` con un `seq` creciente y se emite al stream.
5. Si el cliente se desconecta, la ejecución sigue. Al reconectar con `Last-Event-ID`, se reenvían los eventos guardados y después los nuevos.
6. Al terminar se guardan el mensaje final, los `usage_record` y el estado (`succeeded`, `failed` o `cancelled`).

### Cómo corre una ejecución en segundo plano

1. Una tarea programada (cron de pg-boss), la API con `background: true` o un disparo manual encola el job `run.execute` con el `runId`.
2. `apps/worker` toma el job y corre el mismo `RunExecutor`.
3. Si una herramienta necesita aprobación, la ejecución pasa a `waiting_approval`, guarda su estado y el job termina. La UI lo muestra en la bandeja de aprobaciones. Al aprobar o rechazar, se encola `run.resume`.
4. **Reintentos:** solo ante errores transitorios del proveedor (timeout, 429, 5xx), con backoff exponencial y máximo 3. **Nunca se repite una herramienta que ya terminó**: antes de ejecutar una, se busca en `tool_call` por `(run_id, tool_call_id)`.

### Cómo corre un grupo de agentes (coordinador que delega)

1. Un grupo se ejecuta igual que un agente: desde el chat del grupo, la API, una tarea programada o "Ejecutar ahora". Se crea una ejecución raíz con `group_id` y el agente coordinador.
2. `RunExecutor` arma el coordinador con sus propias instrucciones, más un bloque que agrega el sistema con el objetivo del grupo y la lista de miembros (nombre y para qué sirve cada uno).
3. Por cada miembro, el coordinador recibe una herramienta `delegate_<slug>` con parámetros `{ task: string, context?: string }`. Sus herramientas propias también siguen disponibles.
4. Cada llamada a `delegate_*` crea una **ejecución hija** (`parent_run_id` = raíz, `trigger = delegation`) del miembro, con su versión de agente, su key y sus herramientas, y la corre el mismo `RunExecutor`. La respuesta final del miembro vuelve al coordinador como resultado de la herramienta (máximo 8 KB; el resto queda en la ejecución hija).
5. Si el coordinador pide varias delegaciones en el mismo turno, se ejecutan **en paralelo** (máximo 3 a la vez).
6. **Un solo nivel:** los miembros no reciben herramientas `delegate_*`. Un agente puede ser miembro de varios grupos.
7. **Aprobaciones:** si una ejecución hija pide aprobación, la ejecución raíz también pasa a `waiting_approval`. La aprobación se muestra con el contexto del grupo y, al resolverse, se retoma la hija y después la raíz.
8. **Presupuesto:** cada grupo tiene un tope de costo por ejecución (por defecto US$ 0,50) y un máximo de delegaciones (por defecto 8). Antes de cada llamada al modelo y de cada delegación se suma el costo de la raíz y de sus hijas; si se pasa, la ejecución termina con `limit_reached` y entrega lo que tenga.
9. **Eventos:** la raíz emite `delegation.started` y `delegation.completed`, y reenvía los eventos de las hijas con su `childRunId`, para que la UI muestre el trabajo de cada miembro.
10. **Entrega:** si la raíz termina bien, el sistema manda su respuesta final a los canales del grupo (§9, Entregas).

### Límites por defecto (configurables por variable de entorno)

| Límite | Valor |
| --- | --- |
| Duración de una ejecución interactiva | 10 min |
| Duración de una ejecución en segundo plano | 60 min |
| Turnos de modelo por ejecución | 25 |
| Duración de una herramienta | 60 s |
| Respuesta de herramienta que llega al modelo | 32 KB (se trunca avisando) |
| Ejecuciones simultáneas por workspace | 5 (las hijas de un grupo no cuentan aparte) |
| Delegaciones por ejecución de grupo | 8 |
| Delegaciones en paralelo | 3 |
| Costo máximo por ejecución de grupo | US$ 0,50 (editable por grupo) |
| Duración de una ejecución de grupo | 30 min interactiva, 90 min en segundo plano |

---

## 6. Estructura del repositorio

```
middleware/
├── AGENTS.md                    reglas para agentes (copiar de §13)
├── MIDDLEWARE_MASTER.md         este documento
├── odd/tasks/                   un archivo por WP (gentle-ai ODD)
├── docs/
│   ├── adr/                     decisiones nuevas
│   ├── design/mockups/          maquetas de referencia del estilo (§11.1)
│   ├── runbooks/                deploy, backups, rotación de la clave maestra
│   └── api.md                   protocolo público (§10)
├── apps/
│   ├── web/                     Next.js 16 (App Router)
│   │   └── src/app/
│   │       ├── (auth)/          login, registro, recuperar contraseña
│   │       ├── (app)/
│   │       │   ├── home/        inicio en mosaico (maqueta "inicio")
│   │       │   ├── agents/      lista, nuevo, [agentId]/ (editar, versiones, chat)
│   │       │   ├── groups/      lista, nuevo, [groupId]/ (editar, chat, ejecuciones)
│   │       │   ├── integrations/ Google
│   │       │   ├── delivery/    canales de entrega (email, WhatsApp)
│   │       │   ├── chats/       conversaciones
│   │       │   ├── providers/   credenciales y modelos
│   │       │   ├── tools/       conexiones de herramientas
│   │       │   ├── schedules/   tareas programadas
│   │       │   ├── approvals/   bandeja de aprobaciones
│   │       │   ├── usage/       dashboard de uso
│   │       │   └── settings/    perfil, tokens de API, workspace
│   │       └── shared/          solo lo que usan 2 o más rutas (Scope Rule)
│   ├── api/                     Hono: rutas, middlewares, composición
│   └── worker/                  pg-boss: handlers de jobs y schedules
├── packages/
│   ├── core/                    dominio, puertos y casos de uso (§5)
│   ├── adapters/                db, pi, tools, crypto, queue
│   ├── db/                      esquema Drizzle, migraciones y seeds
│   ├── contracts/               esquemas Zod compartidos web↔api (requests, responses, eventos)
│   ├── ui/                      componentes shadcn compartidos
│   └── config/                  tsconfig, biome y presets de Vitest
├── infra/
│   ├── docker/                  Dockerfiles (web; api+worker comparten imagen)
│   ├── compose.dev.yaml         Postgres + Caddy local
│   ├── compose.prod.yaml        Caddy, web, api, worker y Postgres
│   └── Caddyfile
└── .github/workflows/           ci.yml, deploy.yml
```

---

## 7. Modelo de datos

Reglas generales:
- IDs **UUIDv7** generados en la app (ordenables por tiempo).
- Fechas `timestamptz` en UTC. Dinero en `numeric(14,6)` en **USD**.
- **Toda tabla de negocio tiene `workspace_id` no nulo, indexado**, y todo repositorio lo recibe como parámetro obligatorio (ver S4).
- Borrado lógico (`archived_at`) en agentes y conexiones; las ejecuciones y el uso no se borran.

### Tablas de Better Auth
`user`, `session`, `account`, `verification`, `organization` (= workspace), `member`, `invitation`. Las genera el CLI de Better Auth con el adaptador de Drizzle. Al registrarse un usuario, un hook crea su organización y lo agrega como `owner`.

### Tablas propias

| Tabla | Columnas principales | Notas |
| --- | --- | --- |
| `workspace_key` | `workspace_id` PK, `kek_version`, `wrapped_dek`, `created_at`, `rotated_at` | La clave de datos (DEK) del workspace, cifrada con la clave maestra (§8, S1) |
| `provider_credential` | `id`, `workspace_id`, `provider_id`, `alias`, `ciphertext`, `iv`, `auth_tag`, `kek_version`, `last4`, `base_url` (solo `openai-compatible`), `status` (`unchecked`, `valid`, `invalid`), `last_checked_at`, `created_by`, `archived_at` | Única por `(workspace_id, alias)` |
| `agent` | `id`, `workspace_id`, `name`, `description`, `current_version_id`, `template_id`, `created_by`, `archived_at` | |
| `agent_version` | `id`, `agent_id`, `workspace_id`, `version` (int), `instructions`, `provider_id`, `model_id`, `credential_id`, `params` jsonb (`temperature`, `maxTokens`, `thinkingLevel`), `tools` jsonb, `created_by`, `created_at` | Inmutable. Única por `(agent_id, version)` |
| `tool_connection` | `id`, `workspace_id`, `kind` (`web_search`, `http`, `mcp`), `name`, `config` jsonb (sin secretos), `secret_ciphertext`/`iv`/`auth_tag`/`kek_version` (nullable), `mode` (`read_only`, `read_write`), `status`, `archived_at` | Los secretos se cifran igual que las credenciales |
| `conversation` | `id`, `workspace_id`, `agent_id`, `title`, `created_by`, `created_at`, `updated_at`, `archived_at` | |
| `message` | `id`, `workspace_id`, `conversation_id`, `run_id`, `role` (`user`, `assistant`, `tool_result`), `content` jsonb (formato de mensaje de `pi-ai`), `created_at` | Historial que se le pasa al agente |
| `run` | `id`, `workspace_id`, `agent_id`, `agent_version_id`, `group_id` (nullable), `parent_run_id` (nullable; las delegaciones), `root_run_id`, `conversation_id` (nullable), `trigger` (`chat`, `api`, `schedule`, `manual`, `delegation`), `status` (`queued`, `running`, `waiting_approval`, `succeeded`, `failed`, `cancelled`), `input` jsonb, `output` jsonb, `error_code`, `error_message`, `idempotency_key`, `api_token_id`, `schedule_id`, `queued_at`, `started_at`, `finished_at` | Única por `(workspace_id, idempotency_key)` cuando hay clave |
| `run_event` | `id` bigserial, `run_id`, `workspace_id`, `seq` int, `type`, `payload` jsonb, `created_at` | Única por `(run_id, seq)`. Se borran los `message.delta` después de 7 días |
| `tool_call` | `id`, `run_id`, `workspace_id`, `provider_tool_call_id`, `tool_name`, `args` jsonb (redactado), `status` (`pending`, `waiting_approval`, `running`, `succeeded`, `failed`, `denied`), `result_summary`, `is_error`, `duration_ms`, `started_at`, `finished_at` | Única por `(run_id, provider_tool_call_id)`: así se evita repetir efectos |
| `approval` | `id`, `workspace_id`, `run_id`, `tool_call_id`, `requested_at`, `expires_at`, `decision` (`approved`, `denied`, `expired`), `decided_by`, `decided_at` | |
| `schedule` | `id`, `workspace_id`, `target_type` (`agent`, `group`), `target_id`, `name`, `cron`, `timezone` (por defecto `America/Argentina/Buenos_Aires`), `input` jsonb, `enabled`, `last_run_id`, `next_run_at`, `created_by` | Se registra en pg-boss con nombre `schedule:<id>` |
| `api_token` | `id`, `workspace_id`, `agent_id` (nullable: null = todos), `name`, `prefix` (8 caracteres visibles), `token_hash` (SHA-256), `last_used_at`, `revoked_at`, `created_by` | El token completo se muestra una sola vez |
| `usage_record` | `id`, `workspace_id`, `run_id`, `agent_id`, `provider_id`, `model_id`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `created_at` | Uno por mensaje de asistente; el costo sale de `usage.cost` de `pi-ai` |
| `spend_limit` | `id`, `workspace_id`, `scope` (`workspace`, `agent`, `credential`), `scope_id`, `monthly_usd`, `action` (`warn`, `block`) | Requisito Could (REQ-28) |
| `agent_template` | `id`, `name`, `description`, `instructions`, `suggested_params`, `suggested_tools` | Global, cargado con seed |
| `audit_log` | `id`, `workspace_id`, `actor_user_id`, `actor_token_id`, `action`, `target_type`, `target_id`, `metadata` jsonb, `ip`, `created_at` | Altas, bajas, cambios de credenciales, tokens, integraciones, canales y aprobaciones |
| `agent_group` | `id`, `workspace_id`, `name`, `description`, `goal` (objetivo que se le agrega al coordinador), `coordinator_agent_id`, `mode` (`coordinator`; reservado para `chain` y `parallel`), `max_delegations`, `max_cost_usd`, `created_by`, `archived_at` | El coordinador no puede ser miembro del mismo grupo |
| `agent_group_member` | `group_id`, `agent_id`, `workspace_id`, `slug` (para `delegate_<slug>`), `role_description` (para qué lo usa el coordinador), `position` | PK `(group_id, agent_id)`; único `(group_id, slug)` |
| `integration` | `id`, `workspace_id`, `provider` (`google`), `account_email`, `scopes` text[], `refresh_ciphertext`/`iv`/`auth_tag`/`kek_version`, `access_expires_at`, `status` (`connected`, `needs_reauth`, `revoked`), `connected_by`, `created_at` | Un registro por cuenta; el access token vive solo en memoria |
| `delivery_channel` | `id`, `workspace_id`, `kind` (`email`, `whatsapp`), `address` (email o número en formato E.164), `label`, `verified_at`, `verification_code_hash`, `whatsapp_window_expires_at`, `status` (`pending`, `verified`, `disabled`) | Solo se entrega a canales verificados del propio usuario |
| `delivery_target` | `id`, `workspace_id`, `owner_type` (`agent`, `group`, `schedule`), `owner_id`, `channel_id`, `format` (`full`, `summary`) | Qué canales recibe cada agente, grupo o tarea programada |
| `delivery` | `id`, `workspace_id`, `run_id`, `channel_id`, `status` (`pending`, `sent`, `delivered`, `failed`), `provider_message_id`, `error`, `attempts`, `created_at`, `updated_at` | Una por canal y ejecución; única `(run_id, channel_id)` para no enviar dos veces |

Índices mínimos: `workspace_id` en todas; `run(workspace_id, status)`, `run(conversation_id, queued_at)`, `run_event(run_id, seq)`, `usage_record(workspace_id, created_at)`, `message(conversation_id, created_at)`, `run(root_run_id)`, `run(group_id, queued_at)`, `delivery(run_id)`.

---

## 8. Seguridad (reglas no negociables)

Cada regla tiene al menos un test que la prueba. Un PR que toque estas áreas sin su test no se mergea.

**S1. Cifrado envolvente de secretos.**
- La clave maestra (KEK) llega por la variable `MW_MASTER_KEY`: 32 bytes en base64. Tiene versión (`MW_MASTER_KEY_VERSION`) y nunca se guarda en la base ni en el repo.
- Cada workspace tiene su propia DEK de 32 bytes, guardada en `workspace_key` cifrada con la KEK (AES-256-GCM).
- Cada secreto (key de proveedor, secreto de herramienta) se cifra con la DEK usando AES-256-GCM, un IV aleatorio de 12 bytes, y como datos asociados (AAD) `workspace_id:tabla:id`. Así no se puede mover un secreto de un workspace a otro.
- Rotación: se agrega una versión nueva de KEK y se re-envuelven las DEK con un script (`docs/runbooks/rotar-clave-maestra.md`). Las versiones viejas se leen hasta terminar la rotación.
- Se usa solo `node:crypto`. Nada de criptografía casera fuera de este paquete.

**S2. Los secretos no salen del backend.**
- La API devuelve solo `alias`, `provider_id`, `last4` y `status`.
- `pino` redacta `apiKey`, `authorization`, `cookie`, `secret`, `token`, `password` y `*.key`.
- Los secretos nunca aparecen en `run_event`, `tool_call.args`, `audit_log`, mensajes de error ni trazas.
- Un test de integración busca la key de prueba en todos los logs y tablas después de una ejecución completa, y falla si la encuentra.

**S3. Nada de keys de proveedores en el entorno del servidor.**
`pi-ai` usa variables como `OPENAI_API_KEY` cuando no recibe una key explícita. Eso haría que un usuario use nuestra key sin saberlo. Por eso:
- `apps/api` y `apps/worker` **se niegan a arrancar** si existe alguna variable de key de proveedor conocida (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY` y la lista completa que documenta `pi-ai`).
- Cada ejecución crea su propio `Models` con un `CredentialStore` en memoria que contiene solo la credencial de esa ejecución, y además pasa `apiKey` de forma explícita.
- Nunca se comparte un `Models` entre workspaces ni entre ejecuciones.

**S4. Aislamiento entre workspaces.**
- Todo método de repositorio recibe `workspaceId` como primer parámetro y lo incluye en el `WHERE`.
- El `workspaceId` sale de la sesión o del token de API, **nunca** del body ni de la URL.
- Cada endpoint tiene un test "cross-tenant": el usuario B intenta leer, editar, ejecutar y borrar recursos de A y recibe 404.
- Row Level Security de Postgres queda como mejora posterior (ADR cuando se haga).

**S5. Herramienta HTTP sin SSRF.**
- Solo `https` (en desarrollo, `http` detrás de un flag).
- Se resuelve el DNS y se bloquean IPs privadas, de loopback, link-local (incluido `169.254.169.254`), multicast e IPv6 equivalentes, también después de redirecciones (máximo 3).
- Hay lista de hosts permitidos por conexión, timeout de 15 s, respuesta máxima de 1 MB y headers secretos inyectados desde el cifrado, nunca escritos por el modelo.
- Se aplica la misma protección al conectar servidores MCP remotos y endpoints `openai-compatible`.

**S6. MCP.**
- Solo Streamable HTTP; stdio está prohibido en el servidor.
- Cada conexión tiene modo `read_only` o `read_write`. En `read_only` solo se exponen al modelo las herramientas marcadas con `readOnlyHint` o confirmadas como de lectura por el usuario.
- Toda herramienta que escribe pide aprobación (S9), salvo que el usuario la marque como "aprobar siempre" para ese agente.
- Patrón de referencia: el proxy de conectores con aprobaciones de gentle-dot.

**S7. Sandbox.**
- `pi-codemode`: timeout de 30 s, límite de memoria de 64 MB, y solo las herramientas inyectadas (sin `fetch`, timers ni módulos).
- `gondolin`, si se habilita (`MW_SANDBOX_VM=1`), requiere `/dev/kvm`, red denegada por defecto, `allowedHosts` explícitos y secretos inyectados por host. El servicio arranca sin ese flag aunque gondolin no esté disponible.

**S8. Tokens de API propios.**
- 32 bytes aleatorios, formato `mw_live_<base62>`. Se guarda el SHA-256 y el prefijo visible, se muestran una vez y se pueden revocar.
- Rate limit por token y por workspace: 60 requests por minuto por defecto.

**S9. Aprobaciones y prompt injection.**
- Lo que devuelven las herramientas es dato, nunca instrucción: se envuelve como resultado de herramienta, no se concatena al system prompt.
- Las herramientas con efectos piden aprobación con un resumen legible de qué van a hacer.
- Una aprobación vence a las 24 horas.

**S10. Auth.**
- Cookies `HttpOnly`, `Secure` y `SameSite=Lax`, en el mismo dominio.
- Verificación de email y recuperación de contraseña.
- Rate limit en login y registro.
- Las rutas de API exigen sesión o token; las de escritura validan el origen.

**S11. Repositorio y CI.**
- Sin secretos en el repo; hay `.env.example`.
- El deny-list de gentle-ai bloquea `.env` y credenciales.
- GGA revisa cada commit contra `AGENTS.md`.
- Dependabot o Renovate semanal, con las librerías de Pi agrupadas.

**S12. Infraestructura.**
- Postgres no se expone a Internet; solo la red interna de Docker.
- Backups diarios cifrados con `pg_dump` fuera del VPS, con 14 días de retención y una restauración probada al mes.
- La clave maestra se guarda fuera del servidor, en el gestor de contraseñas de Luca.

**S13. Integración con Google.**
- La integración es un OAuth propio, separado del login con Google: `access_type=offline`, `include_granted_scopes=true` y `state` firmado con PKCE.
- Pide solo `openid email`, `https://www.googleapis.com/auth/calendar.readonly` y `https://www.googleapis.com/auth/gmail.send`, y solo cuando el usuario activa la herramienta que los usa.
- El refresh token se cifra como en S1. El access token vive solo en memoria y se renueva en una sección serializada, para no renovar dos veces a la vez.
- Desconectar revoca el token en Google y lo borra.
- `gmail.send` a cualquier dirección que no sea un canal verificado del propio usuario pide aprobación.
- Mientras Google no verifique la app, funciona solo para los usuarios de prueba cargados en la consola de Google (ver Q9).

**S14. Canales de entrega.**
- Solo se entrega a canales verificados del propio usuario: el email con un enlace de confirmación, y WhatsApp con un código que el usuario manda a nuestro número, lo que además abre la ventana de 24 horas.
- Cada entrega es idempotente por `(run_id, channel_id)`, con 3 reintentos con backoff, y respeta la baja: escribir "BAJA" por WhatsApp o el enlace del pie del mail desactivan el canal.
- El webhook de WhatsApp valida la firma `X-Hub-Signature-256` con el secreto de la app de Meta. Lo que llega por ese webhook es dato, nunca instrucción para un agente.
- Los mensajes no incluyen secretos y truncan el resultado (WhatsApp: resumen corto más un enlace a la ejecución en la app).

---

## 9. Herramientas de los agentes

Todas implementan el puerto `ToolRuntime` y se exponen al modelo como `AgentTool` de `pi-agent-core`, con parámetros en TypeBox.

| Herramienta | Implementación | Config del usuario | ¿Aprobación? |
| --- | --- | --- | --- |
| `web_search` | Interfaz `SearchProvider` con adaptadores **Brave Search** y **Tavily**; el usuario trae su key | Conexión `web_search` con proveedor y key | No |
| `http_request` | `fetch` con la protección de S5; métodos permitidos por conexión | Conexión `http` con base URL, hosts, headers secretos y métodos | GET no; POST, PUT, PATCH y DELETE sí, por defecto |
| `mcp_<servidor>_<tool>` | `pi-mcp` con `StreamableHttpTransport` y OAuth de `pi-mcp/oauth`; nombres saneados a 64 caracteres | Conexión `mcp` con URL, modo y sign-in | Las de escritura sí |
| `run_code` | `pi-codemode`: el modelo escribe JavaScript que puede llamar a las otras herramientas del agente | Activar por agente | No (no tiene efectos propios; las herramientas internas siguen sus reglas) |
| `run_shell` (opcional) | `gondolin` con micro-VM | Solo si `MW_SANDBOX_VM=1` | Sí |
| `google_calendar_events` | API de Google Calendar v3: lista los calendarios y los eventos entre dos fechas, en la zona horaria del usuario | Integración con Google conectada | No |
| `gmail_send` | API de Gmail `users.messages.send`, enviado como el usuario | Integración con Google conectada | Solo si el destinatario no es un canal verificado del usuario |
| `delegate_<miembro>` | Ejecución hija del miembro (§5, "Cómo corre un grupo") | Solo el coordinador de un grupo | No (las herramientas del miembro siguen sus propias reglas) |

### Entregas

Al terminar bien una ejecución raíz (de un agente o de un grupo), el job `delivery.send` manda la respuesta final a cada canal en `delivery_target`:

- **Email:** interfaz `Mailer` con nuestro proveedor transaccional (Q3) y plantilla HTML con el estilo de §11.1. Asunto: nombre del agente o grupo y fecha. Cuerpo: el resultado en markdown convertido a HTML y un enlace a la ejecución. Pie con "Dejar de recibir".
- **WhatsApp:** WhatsApp Cloud API con nuestro número de empresa. Fuera de la ventana de 24 horas solo se pueden mandar **plantillas aprobadas por Meta**, y cada una se cobra según su categoría y el país. Se usa una plantilla *utility* (`resumen_listo`), con el nombre del agente o grupo, un resumen de hasta 900 caracteres y un botón a la ejecución. Dentro de la ventana, el mensaje sale como texto libre.
- Cada envío queda en `delivery` con su estado, actualizado por el webhook de WhatsApp o por la respuesta del proveedor de email. La UI de la ejecución muestra "Enviado por email y WhatsApp".

Reglas comunes: timeout, tamaño máximo de resultado (32 KB al modelo, completo en `tool_call` si mide menos de 256 KB) y errores devueltos como `isError: true` con un mensaje que el modelo pueda entender. Cada llamada queda en `tool_call` y emite `tool.started` y `tool.completed`.

---

## 10. API

Todas las rutas validan con Zod (`packages/contracts`) y responden JSON con errores de la forma `{ error: { code, message } }`, donde `message` está en español y es seguro mostrarlo.

### API interna (sesión por cookie, la usa la web)

| Método y ruta | Qué hace |
| --- | --- |
| `ALL /api/auth/*` | Handler de Better Auth montado en Hono |
| `GET /api/me` | Usuario y workspace activos |
| `GET /api/providers` | Catálogo de proveedores soportados |
| `GET/POST /api/credentials`, `PATCH/DELETE /api/credentials/:id` | ABM de credenciales; nunca devuelve la key |
| `POST /api/credentials/:id/test` | Prueba la key con una llamada mínima; actualiza `status` |
| `GET /api/models?credentialId=` | Modelos disponibles con esa credencial (descubrimiento de `pi-ai`, cache de 1 h) |
| `GET/POST /api/agents`, `GET/PATCH/DELETE /api/agents/:id` | ABM; `PATCH` crea una versión nueva |
| `GET /api/agents/:id/versions`, `POST /api/agents/:id/versions/:v/restore` | Historial y restauración |
| `POST /api/agents/:id/duplicate` | Copia editable |
| `GET /api/templates` | Plantillas de agentes |
| `GET/POST /api/conversations`, `PATCH/DELETE /api/conversations/:id`, `GET /api/conversations/:id/messages` | Conversaciones e historial paginado |
| `POST /api/runs` | Inicia una ejecución `{ agentId, conversationId?, input, background? }`; devuelve `{ runId }` |
| `GET /api/runs/:id/events` | SSE con reanudación por `Last-Event-ID` |
| `POST /api/runs/:id/cancel` | Cancela |
| `GET /api/runs?status=&agentId=` | Lista de ejecuciones |
| `GET /api/approvals`, `POST /api/approvals/:id` | Bandeja y decisión `{ decision: "approved" \| "denied" }` |
| `GET/POST /api/tool-connections`, `PATCH/DELETE /api/tool-connections/:id`, `POST /api/tool-connections/:id/test` | Herramientas del workspace; OAuth de MCP en `/api/tool-connections/:id/oauth/*` |
| `GET/POST /api/schedules`, `PATCH/DELETE /api/schedules/:id`, `POST /api/schedules/:id/run-now` | Tareas programadas |
| `GET/POST /api/api-tokens`, `DELETE /api/api-tokens/:id` | Tokens de API |
| `GET /api/usage?from=&to=&groupBy=day\|agent\|group\|provider\|model` | Agregados de uso y costo |
| `GET/POST /api/groups`, `GET/PATCH/DELETE /api/groups/:id` | ABM de grupos con coordinador, miembros, objetivo y límites |
| `POST /api/groups/:id/runs` | Ejecuta el grupo `{ input, conversationId?, background? }` (también se puede vía `POST /api/runs` con `groupId`) |
| `GET /api/runs/:id/children` | Delegaciones de una ejecución de grupo |
| `GET /api/integrations`, `POST /api/integrations/google/connect`, `GET /api/integrations/google/callback`, `DELETE /api/integrations/:id` | Integración con Google |
| `GET/POST /api/delivery-channels`, `POST /api/delivery-channels/:id/verify`, `DELETE /api/delivery-channels/:id` | Canales de entrega y su verificación |
| `PUT /api/delivery-targets` | Qué canales recibe un agente, un grupo o una tarea programada |
| `POST /webhooks/whatsapp`, `GET /webhooks/whatsapp` | Webhook de Meta (verificación y estados; firma obligatoria, S14) |
| `GET /healthz`, `GET /readyz` | Salud (sin auth) |

### API pública (Bearer `mw_live_…`)

| Método y ruta | Qué hace |
| --- | --- |
| `POST /v1/groups/:groupId/runs` | Igual que el de agentes, para un grupo |
| `POST /v1/agents/:agentId/runs` | Body `{ input, conversationId?, stream?, background?, idempotencyKey? }`. Con `stream: true` responde SSE; si no, espera y devuelve el resultado (máximo 120 s, si no `202` con `runId`) |
| `GET /v1/runs/:runId` | Estado y resultado |
| `GET /v1/runs/:runId/events` | SSE |

Se documenta en `docs/api.md` con ejemplos en `curl` y TypeScript.

### Protocolo de eventos (SSE)

Cada evento lleva `id` igual a `seq`, `event` igual al tipo y `data` en JSON. Los tipos se definen en `packages/contracts/events.ts` y el front los consume tipados.

| Tipo | Datos |
| --- | --- |
| `run.started` | `runId`, `agentVersionId`, `model` |
| `message.delta` | `messageId`, `text` |
| `message.completed` | `messageId`, `content` |
| `thinking.delta` | `messageId`, `text` (solo si el modelo lo emite y el agente lo muestra) |
| `tool.started` | `toolCallId`, `name`, `argsPreview` (redactado) |
| `tool.completed` | `toolCallId`, `status`, `resultPreview`, `durationMs` |
| `approval.requested` | `approvalId`, `toolCallId`, `summary`, `expiresAt` |
| `approval.resolved` | `approvalId`, `decision` |
| `usage` | `inputTokens`, `outputTokens`, `costUsd` acumulados (en un grupo, incluye las hijas) |
| `delegation.started` | `childRunId`, `memberSlug`, `memberName`, `task` |
| `delegation.completed` | `childRunId`, `status`, `outputPreview`, `costUsd` |
| `child.event` | `childRunId` y el evento de la hija (mismos tipos de esta tabla) |
| `delivery.updated` | `channelKind`, `status` |
| `run.completed` | `output`, `finishedAt` |
| `run.failed` | `code`, `message` |
| `run.cancelled` | — |

### Errores de proveedor

`ModelGateway` traduce los errores de `pi-ai` a estos códigos, con mensajes en español:

`invalid_api_key`, `insufficient_quota`, `rate_limited`, `model_not_found`, `context_too_long`, `provider_timeout`, `provider_unavailable`, `content_filtered`, `tool_failed`, `run_timeout`, `limit_reached`, `integration_needs_reauth`, `delivery_failed`, `unknown`.

---

## 11. Frontend

- **App Router de Next.js 16** con las rutas de §6. Los Server Components cargan datos llamando a la API con la cookie reenviada. Los Client Components manejan el chat, los formularios y todo lo interactivo.
- **Scope Rule:** cada ruta guarda sus componentes en su carpeta; `shared/` es solo para lo que usan dos o más rutas, y `packages/ui` para las primitivas de shadcn. Usar el agente `scope-rule-architect-nextjs` de Gentleman para decidir dónde va cada cosa.
- **Datos en cliente:** TanStack Query. **Estado de UI:** Zustand (panel abierto, borradores). **Formularios:** React Hook Form con resolvers de Zod 4, reutilizando los esquemas de `packages/contracts`.
- **Chat:** lector SSE propio (`fetch` + `ReadableStream`, con reintento y `Last-Event-ID`), render de markdown con resaltado de código, botón de cortar, tarjetas de herramientas plegables y tarjeta de aprobación dentro del chat.
- **Idioma:** UI en español rioplatense con todos los textos en un archivo de mensajes (`next-intl`), listo para sumar inglés (ver §16).
- **Diseño:** el sistema de §11.1, implementado como tokens sobre shadcn/ui. Tema claro y oscuro según el sistema, con selector manual. Mobile responsive, foco visible y contraste AA. Cada pantalla tiene estados de carga, vacío y error (REQ-30).

### Pantallas del MVP

| Pantalla | Contenido |
| --- | --- |
| Registro, login y recuperar contraseña | Email y contraseña, botón de Google |
| Inicio | Mosaico (maqueta "inicio"): bloque de marca, menú oscuro de crear, proveedores, un flujo programado dibujado con conectores, uso del mes y un campo para preguntarle a un agente |
| Onboarding | 1) Cargar la primera key → 2) Crear el primer agente desde una plantilla → 3) Chatear. Meta: menos de 5 minutos |
| Agentes | Lista con búsqueda; tarjeta con modelo y última actividad; duplicar y archivar |
| Editor de agente | Maqueta "nuevo agente": bloques /01 Identidad, /02 Instrucciones, /03 Modelo (pastillas de proveedor, key, modelo, creatividad y razonamiento) y /04 Herramientas (interruptores y etiqueta "Pide aprobación"). Columna lateral con "Así queda conectado", que dibuja el agente y sus herramientas con conectores punteados en vivo, y "Probalo antes de crearlo", un chat de prueba en panel oscuro. Más el historial de versiones |
| Grupos | Lista de grupos. El constructor reusa el estilo del editor de agentes: objetivo del grupo, elección del coordinador, miembros con "para qué sirve" y un diagrama vivo (coordinador arriba, miembros abajo, unidos con conectores punteados). También tarea programada, canales de entrega y límites (costo y delegaciones) |
| Chat o ejecución de grupo | Como el chat de agente, pero cada delegación se muestra como una tarjeta del miembro, unida al coordinador con conector punteado y desplegable para ver su trabajo. Al final, el estado de las entregas |
| Integraciones | Google: conectar, cuenta conectada, permisos activos, desconectar y aviso de reautorización |
| Canales de entrega | Agregar email o WhatsApp, verificación con código o enlace, estado y prueba de envío |
| Chat | Conversaciones del agente a la izquierda; mensajes, herramientas y aprobaciones en el centro; costo de la conversación |
| Proveedores | Credenciales por proveedor, estado, probar y modelos disponibles |
| Herramientas | Conexiones de búsqueda, HTTP y MCP, con modo y prueba |
| Tareas programadas | Cron con ayuda en lenguaje natural ("todos los lunes a las 9"), zona horaria, última y próxima ejecución, ejecutar ahora |
| Aprobaciones | Pendientes y resueltas, con aprobar o rechazar |
| Ejecuciones | Historial con filtros y detalle con eventos |
| Uso | Gráficos de costo y tokens por día, agente, proveedor y modelo |
| Ajustes | Perfil, tokens de API y zona del workspace |

### 11.1 Sistema de diseño: "cálido y táctil"

Elegido por Luca (D19). Las maquetas de referencia están en `docs/design/mockups/`: `chat.dc.html`, `inicio.dc.html` y `nuevo-agente.dc.html`. Son HTML estático, para leer los estilos exactos; no se ejecutan en la app. Se implementa en `packages/ui` (WP-07) como variables CSS mapeadas a los tokens de shadcn y al `@theme` de Tailwind 4. **Ningún componente usa un color, radio o sombra fuera de estos tokens.**

**La idea:** objetos suaves y apilados, como fichas de papel grueso sobre una mesa clara. Fondo crema; tarjetas beige con esquinas muy redondeadas; dentro de ellas, filas más claras con un brillo blanco en el borde superior. **Un solo color de acento**, un naranja rojizo, usado poco. Paneles **marrón oscuro con degradé** reservados para los momentos importantes. **Conectores punteados naranjas** para dibujar cómo se conectan agentes, herramientas y grupos.

#### Colores

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| `--bg` | `#F8F1EC` | `#1B1613` | Fondo de la página |
| `--surface` | `#EFE5DC` | `#251E1A` | Tarjetas grandes (secciones, barra lateral) |
| `--surface-2` | `#F6EEE7` | `#2B231F` | Grupos internos (controles agrupados, pie de la barra) |
| `--raised` | `#FBF7F3` | `#342B26` | Filas, campos, pastillas y botones secundarios dentro de una tarjeta |
| `--ink` | `#221B17` | `#F3EAE3` | Texto principal |
| `--ink-2` | `#54473F` | `#CDBFB4` | Texto secundario y navegación inactiva |
| `--muted` | `#6E6259` | `#A89A8F` | Ayudas y metadatos (contraste AA sobre `--surface`) |
| `--accent` | `#D93D0B` | `#FF6A33` | Botón primario, selección, interruptor encendido, badge |
| `--on-accent` | `#FFFFFF` | `#1B1613` | Texto sobre `--accent` |
| `--accent-text` | `#B8360A` | `#FF8A5C` | Enlaces y textos de acento (números /01) |
| `--accent-soft` | `#FBE3D6` | `#4A2A1E` | Etiquetas como "Pide aprobación" (texto `#8F2905` en claro, `#FFB899` en oscuro) |
| `--accent-gradient` | `linear-gradient(160deg, #FF7A45, #F04A12 60%, #D93D0B)` | igual | Solo en botones de ícono principales (enviar, cerrar) y en el ícono de marca |
| `--connector` | `#F2A07E` | `#C2643F` | Líneas punteadas de flujos |
| `--dark-panel` | `radial-gradient(120% 120% at 100% 0%, #A99A90, #5C4D45 42%, #2B231F)` | `radial-gradient(… #6E5F56, #3A2F2A 42%, #15110F)` | Paneles destacados: aprobaciones, menú de crear, prueba del agente, bloque de marca |
| `--success` / `--warning` / `--danger` | `#3F8F5A` / `#C9A227` / `#B42318` | `#6BC48A` / `#E3C155` / `#F97066` | Puntos de estado, siempre acompañados de texto |

#### Tipografía
- **Geist** para toda la interfaz (400, 500 y 600; 700 solo en el logotipo) y **Geist Mono** para keys enmascaradas, costos, IDs, modelos y la numeración `/01`. Las dos tienen licencia OFL y se cargan con `next/font`.
- Escala en px: 12, 13, 15 (base), 17 (títulos de tarjeta), 22, 26 (título de página) y 40 (bloques de marca). Interlineado de 1,5 en el cuerpo y de 1,15 en los títulos grandes. Tracking de −0,02 a −0,03 em en los tamaños de 22 o más.
- Los títulos son en oración ("Nuevo agente"), nunca en mayúsculas.

#### Forma y profundidad
- Radios: **28 px** en tarjetas grandes, **18 a 22 px** en filas y burbujas de chat, **16 px** en campos y botones, **12 px** en íconos en baldosa, **999 px** en badges.
- Elevación "en relieve" (`--raised`): `inset 0 1px 0 #FFFFFF, 0 1px 2px rgba(60,40,30,.08)`. En oscuro: `inset 0 1px 0 rgba(255,255,255,.06), 0 1px 2px rgba(0,0,0,.4)`.
- Panel oscuro: `0 10px 24px rgba(43,35,31,.22)`. Botón de acento: `inset 0 1px 0 rgba(255,255,255,.35), 0 6px 14px rgba(217,61,11,.28)`.
- Sin bordes de 1 px como separador principal: la separación la dan el cambio de superficie y el espacio. Espaciado en múltiplos de 4 (16 entre tarjetas, 22 o 24 dentro).

#### Elementos de firma (componentes de `packages/ui`)
- `Card` (superficie de 28 px), `RaisedRow`, `Field`, `PillRadio` (pastillas de proveedor con borde de acento al elegirlas), `Segmented`, `Switch`, `Badge`, `IconTile` y `DarkPanel`.
- `SlashHeading`: el título de sección con número en mono (`/01 Identidad`). Solo se usa cuando hay una secuencia real.
- `FlowConnector` y `FlowNode`: conectores punteados de 2 px con `--connector` y nodos en relieve, para el diagrama "Así queda conectado", los grupos y los flujos programados. Se construyen con elementos y CSS, no con un SVG único, para que sean accesibles y se adapten al ancho.
- `ChatBubble`: la del usuario va en marrón oscuro con texto claro; la del agente, sobre la superficie, sin burbuja. `ToolStep` muestra el paso de herramienta como nodo unido por conector. `ApprovalCard` va en `DarkPanel`.
- `Composer`: campo en relieve, botón de dictado en relieve y botón de enviar con `--accent-gradient`.
- `BrandTile`: la baldosa naranja con "mw" del logo provisorio.

#### Reglas
- **Un solo botón primario naranja por pantalla.** El resto son botones en relieve o de texto.
- El naranja **nunca** se usa como texto sobre fondos claros: para eso existe `--accent-text`.
- Proveedores con monogramas en baldosa, no con logos de terceros, hasta revisar las guías de marca de cada uno.
- Las keys nunca tienen botón de copiar (S2): muestran alias, `····últimos4` en mono y estado.
- Targets táctiles de al menos 44 px. Foco visible: anillo de 2 px de `--accent` con 2 px de separación.
- Movimiento solo para responder a una acción: aparición del streaming, apertura de un panel, cambio de un interruptor. Respetar `prefers-reduced-motion`.
- Los bloques de marca con degradé desenfocado son decoración: van con `aria-hidden` si no tienen texto, y el texto encima cumple contraste AA.

---

## 12. Entorno de construcción (para los agentes)

Se prepara una vez, en WP-00. Los comandos son los documentados al 9/10/2026; confirmalos en cada README antes de correrlos.

1. **Claude Code** instalado y con sesión iniciada.
2. **gentle-ai:** `brew install gentleman-programming/tap/gentle-ai` (o el script de `curl` del README). Correr `gentle-ai` y elegir Claude Code, Engram, skills, Context7 y CodeGraph. Verificar con `gentle-ai doctor`. Dejar la revisión RDD **activada** (es el valor por defecto).
3. **Engram:** `engram setup claude-code`. En la raíz del repo, `engram init middleware` para fijar el proyecto.
4. **GGA:** `brew install gentleman-programming/tap/gga`, después `gga init` y `gga install` en el repo. En `.gga`, el proveedor es Claude y el archivo de reglas es `AGENTS.md`.
5. **Skills de Gentleman** (de `Gentleman-Programming/Gentleman-Skills/curated`) en `.claude/skills/` del repo: `typescript`, `react-19`, `nextjs-15` (vale por convenciones; la API es la de Next 16), `tailwind-4`, `zod-4`, `zustand-5`, `playwright`, `github-pr`.
6. **Agente de arquitectura:** copiar `.claude/agents/scope-rule-architect-NextJS.md` de `Gentleman-Programming/gentleman-architecture-agents` a `.claude/agents/` del repo (en Claude Code se invoca como `scope-rule-architect-nextjs`).
7. **Skills propias** que se crean en WP-00 (`.claude/skills/`):
   - `pi-stack`: cómo usar `pi-ai`, `pi-agent-core`, `pi-mcp` y `pi-codemode` en este repo, con S3 incluida.
   - `hono-api`: estructura de rutas, validación, errores y tests.
   - `drizzle-db`: esquema, migraciones y la regla de `workspaceId`.
8. **Flujo de trabajo:** ODD de gentle-ai. Cada WP abre `odd/tasks/<wp-id>.md` con alcance, tareas, evidencia y siguiente paso, y lo espeja en Engram. Cada tarea cierra con un commit en la rama del WP. Push, PR y merge son pasos separados: **Luca mergea**.

### Orquestación
- Un **agente padre** lleva el plan (§15), abre los WP y verifica los resultados. No confía en lo que un subagente dice haber hecho: corre los checks.
- **Subagentes en paralelo** solo para WP sin dependencia entre sí y en carpetas distintas (por ejemplo, `apps/web/src/app/(app)/providers` y `packages/adapters/tools`).
- **Verificación independiente** para los WP de riesgo alto (WP-06, WP-10, WP-30, WP-34, WP-42, WP-43, WP-44, WP-53, WP-54, WP-56, WP-70): un subagente que no escribió el código revisa contra §8 y corre los tests de seguridad.

---

## 13. Convenciones (contenido de `AGENTS.md`)

Copiar este bloque tal cual a `AGENTS.md` en la raíz:

```markdown
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
```

---

## 14. Tests, CI y deploy

### Pirámide
- **Unit (Vitest):** dominio, casos de uso con puertos falsos, cifrado, mapeo de errores, parser de cron y protección SSRF. Cobertura mínima del 85 % en `packages/core` y `packages/adapters/crypto`.
- **Integración (Vitest + Testcontainers):** repositorios contra Postgres real, endpoints de Hono con la app armada, ejecuciones completas con el proveedor faux de `pi-ai`, jobs de pg-boss y la suite cross-tenant.
- **Seguridad:** redacción de secretos (S2), arranque bloqueado con variables de proveedores (S3), cross-tenant (S4), SSRF con IPs privadas y redirecciones (S5), herramientas MCP en `read_only` (S6) y límites del sandbox (S7).
- **E2E (Playwright):** registro, onboarding, crear agente, chatear con streaming (proveedor faux detrás de un flag de test), aprobar una herramienta, crear una tarea programada y ver el uso.

### CI (GitHub Actions, `ci.yml`)
1. `pnpm install --frozen-lockfile`
2. `turbo run typecheck lint test` con cache.
3. Integración con servicio Postgres.
4. Build de imágenes y E2E con `compose.prod.yaml` en modo test.
5. GGA en modo PR sobre el diff.

Los merges a `main` están bloqueados sin todo en verde.

### Deploy (`deploy.yml`, manual o por tag)
1. Build y push de imágenes a GHCR con tag del commit.
2. Por SSH al VPS: `docker compose pull && docker compose up -d`. Las migraciones de Drizzle corren en un contenedor `migrate` antes de levantar la API.
3. Smoke test a `/readyz` y rollback al tag anterior si falla.

### Requisitos del VPS
- Linux x86_64 o arm64, 4 vCPU, 8 GB de RAM y 80 GB de disco como punto de partida.
- Docker y Compose.
- **Para habilitar gondolin:** soporte de virtualización anidada (`/dev/kvm`). Verificarlo antes de elegir proveedor de VPS.

---

## 15. Plan de trabajo

Los paquetes se agrupan por los hitos que ya existen en Notion ("Hitos del MVP") y citan los requisitos por su ID (`REQ-n` de la base "Requisitos y roadmap"). Los marcados **NUEVO** no existen todavía en Notion: agregalos ahí al empezar.

Formato: **ID — Título** · depende de · requisitos · criterios de aceptación.

### Hito 1: Fundaciones
- **WP-00 — Repo y tooling.** Sin dependencias. REQ-1, REQ-2.
  Monorepo pnpm + Turborepo, `packages/config`, Biome, TypeScript estricto, Vitest y Playwright configurados. `AGENTS.md`, `.gga`, skills y agentes de §12. ADR-0001 con el stack de §3.
  *Acepta:* `pnpm typecheck lint test` en verde en un repo vacío con un test de ejemplo; GGA corre en un commit de prueba.
- **WP-01 — Entorno local.** Depende de WP-00.
  `infra/compose.dev.yaml` con Postgres 18 y Caddy, y `pnpm dev` que levanta web, api y worker.
  *Acepta:* `pnpm dev` levanta todo y `/readyz` responde 200.
- **WP-02 — Base de datos.** Depende de WP-00. REQ-3.
  `packages/db` con el esquema de §7 (tablas propias), migraciones, seed de plantillas y helper de Testcontainers.
  *Acepta:* las migraciones corren en limpio y de forma idempotente; test de integración que inserta y lee cada tabla.
- **WP-03 — Auth y workspace.** Depende de WP-01 y WP-02. REQ-4.
  Better Auth en Hono, email, Google, organizaciones, hook que crea el workspace, middleware que resuelve `workspaceId`, y páginas de login, registro y recuperación.
  *Acepta:* E2E de registro, login, logout y recuperación; un usuario nuevo tiene exactamente un workspace.
- **WP-07 — Sistema de diseño.** Depende de WP-00. **NUEVO.**
  Tokens de §11.1 (claro y oscuro) en `packages/ui` y componentes de firma, con una página `/dev/ui` que los muestra todos y compara contra las maquetas de `docs/design/mockups/`.
  *Acepta:* cada componente existe en claro y oscuro; axe sin violaciones; no aparecen colores fuera de los tokens (regla de lint o test de búsqueda).
- **WP-04 — Shell de la web.** Depende de WP-03 y WP-07. REQ-5.
  Layout con barra lateral en tarjeta, Inicio en mosaico, tema según el sistema con selector, `next-intl` y páginas vacías con estados vacíos.
  *Acepta:* navegación completa en desktop y mobile; test de accesibilidad básico con axe en Playwright.
- **WP-05 — CI.** Depende de WP-00 (se completa con WP-02).
  `ci.yml` de §14.
  *Acepta:* un PR con un test roto queda bloqueado.
- **WP-06 — Cifrado envolvente.** Depende de WP-02. **Riesgo alto.** REQ-7.
  `packages/adapters/crypto` con S1, el chequeo de arranque de S3 y el runbook de rotación.
  *Acepta:* tests de cifrar y descifrar, AAD cambiado que falla, rotación de KEK, y arranque bloqueado con `OPENAI_API_KEY` presente.

### Hito 2: Proveedores y API keys
- **WP-10 — Bóveda de credenciales.** Depende de WP-03 y WP-06. **Riesgo alto.** REQ-6, REQ-7.
  ABM de credenciales y pantalla de Proveedores.
  *Acepta:* varias keys por proveedor con alias; la API nunca devuelve la key; test de redacción S2; test cross-tenant.
- **WP-11 — ModelGateway con pi-ai.** Depende de WP-06. REQ-8.
  Adaptador que arma un `Models` por ejecución, mapea errores (§10) y expone `stream` y `listModels`. Catálogo de proveedores.
  *Acepta:* tests con el proveedor faux para streaming, herramientas y mapeo de cada error; agregar un proveedor es una línea de registro.
- **WP-12 — Probar conexión.** Depende de WP-10 y WP-11. REQ-9.
  *Acepta:* una key válida queda `valid`; una inválida, `invalid` con mensaje claro (probado con un servidor HTTP falso).
- **WP-13 — Listar modelos.** Depende de WP-12. REQ-10.
  *Acepta:* los modelos vienen del descubrimiento de `pi-ai`, sin lista fija, con cache de 1 h.
- **WP-14 — Endpoints compatibles con OpenAI.** Depende de WP-13. REQ-11 (Could).
  *Acepta:* `base_url` pasa la protección SSRF; funciona contra un servidor compatible falso.

### Hito 3: Constructor de agentes
- **WP-20 — Agentes y versiones.** Depende de WP-10. REQ-12, REQ-13, REQ-14, REQ-16.
  ABM, versionado inmutable, duplicar, restaurar, y el editor de §11.
  *Acepta:* editar crea una versión nueva; restaurar crea otra versión igual a la elegida; no se puede elegir una credencial de otro workspace.
- **WP-21 — Plantillas.** Depende de WP-20. REQ-15.
  Seed de 6 plantillas: soporte, redacción, investigación web, analista de datos con código, integrador HTTP y resumen diario programado.
  *Acepta:* crear desde una plantilla deja el agente listo para chatear con solo elegir la credencial.

### Hito 4: Ejecución y chat
- **WP-30 — Motor de ejecución.** Depende de WP-11 y WP-20. **Riesgo alto.**
  `RunExecutor` en `packages/core`, adaptador con `pi-agent-core`, `run_event` con `seq`, límites de §5 y usage.
  *Acepta:* una ejecución completa con el proveedor faux genera los eventos de §10 en orden, guarda el mensaje y el uso, respeta timeout y cantidad máxima de turnos, y la cancelación funciona.
- **WP-31 — Chat con streaming.** Depende de WP-30. REQ-17.
  SSE con reanudación y UI de chat.
  *Acepta:* E2E que corta la conexión a mitad de la respuesta, reconecta y no pierde ni duplica texto; el botón de cortar funciona.
- **WP-32 — Historial.** Depende de WP-31. REQ-18.
  *Acepta:* retomar, renombrar y archivar conversaciones; el historial se pasa al agente respetando el contexto del modelo.
- **WP-33 — Errores del proveedor.** Depende de WP-30. REQ-19.
  *Acepta:* cada código de §10 se muestra con su mensaje en el chat (test por código).
- **WP-34 — API pública y tokens.** Depende de WP-30. **Riesgo alto.** REQ-20.
  `/v1/*`, tokens, rate limit, idempotencia y `docs/api.md`.
  *Acepta:* modos con y sin streaming, token revocado que da 401, rate limit que da 429, misma `idempotencyKey` que no duplica la ejecución.
- **WP-35 — Comparar modelos.** Depende de WP-31. REQ-21 (Could).

### Hito 5: Herramientas
- **WP-40 — Framework de herramientas y aprobaciones.** Depende de WP-30. REQ-22.
  Puerto `ToolRuntime`, registro, `tool_call`, aprobaciones con vencimiento, tarjeta de aprobación en el chat y bandeja.
  *Acepta:* una herramienta que requiere aprobación pausa la ejecución, aprobar la retoma y rechazar le devuelve al modelo un resultado "denegado".
- **WP-41 — Búsqueda web.** Depende de WP-40. REQ-23.
  Brave y Tavily, con la key del usuario.
  *Acepta:* el agente cita fuentes; probado con respuestas grabadas.
- **WP-42 — HTTP y webhooks.** Depende de WP-40. **Riesgo alto.** REQ-24.
  *Acepta:* la suite SSRF de S5 en verde; headers secretos que nunca aparecen en eventos.
- **WP-43 — Servidores MCP remotos.** Depende de WP-40. **Riesgo alto.** **NUEVO.**
  `pi-mcp` con Streamable HTTP, OAuth y modos.
  *Acepta:* con un servidor MCP falso, el modo `read_only` oculta las herramientas de escritura y el modo `read_write` pide aprobación.
- **WP-44 — Ejecución de código (codemode).** Depende de WP-40. **Riesgo alto.** **NUEVO.**
  *Acepta:* timeout y límite de memoria probados; el script solo puede llamar herramientas del agente; las aprobaciones internas se respetan.
- **WP-45 — Sandbox VM con gondolin.** Depende de WP-44 y de un VPS con KVM. Opcional, **NUEVO**, post-MVP salvo decisión de Luca.
- **WP-46 — Archivos como contexto.** REQ-25 (Could), post-MVP.

### Hito 5b: Segundo plano (NUEVO, va antes del hito 6)
- **WP-50 — Worker y ejecuciones en segundo plano.** Depende de WP-30 y WP-40.
  pg-boss, `run.execute`, `run.resume`, reintentos sin repetir efectos y límite de concurrencia por workspace.
  *Acepta:* matar el worker a mitad de una ejecución y reiniciarlo no duplica herramientas ya ejecutadas; los reintentos ocurren solo ante errores transitorios.
- **WP-51 — Tareas programadas.** Depende de WP-50.
  ABM de cron con zona horaria, ejecutar ahora, y pantalla con historial.
  *Acepta:* una tarea cada minuto en test genera ejecuciones; deshabilitarla las detiene.
- **WP-52 — Aprobaciones asíncronas.** Depende de WP-50.
  Bandeja con contador, vencimiento y aviso por email (si se resuelve §16).
  *Acepta:* una ejecución en segundo plano espera aprobación y se retoma al aprobar.

### Hito 5c: Grupos, Google y entregas (NUEVO, MVP)
- **WP-53 — Integración con Google.** Depende de WP-06 y WP-40. **Riesgo alto.**
  OAuth propio con permisos incrementales, tokens cifrados, renovación serializada, revocación, y las herramientas `google_calendar_events` y `gmail_send` (S13).
  *Acepta:* con un servidor OAuth falso, conectar, renovar, revocar y reautorizar funcionan; `gmail_send` a una dirección ajena pide aprobación; el refresh token nunca aparece en logs ni eventos.
- **WP-54 — Canales de entrega.** Depende de WP-50. **Riesgo alto.**
  `Mailer` (proveedor de Q3, con consola en desarrollo), WhatsApp Cloud API con verificación del número, plantilla `resumen_listo`, webhook firmado, job `delivery.send` y pantalla de canales (S14).
  *Acepta:* una ejecución terminada genera una entrega por canal sin duplicar ante reintentos; un webhook con firma inválida da 401; la baja desactiva el canal; dentro de la ventana de 24 horas se manda texto libre y fuera, la plantilla.
- **WP-55 — Grupos de agentes: modelo y constructor.** Depende de WP-20 y WP-07.
  ABM de grupos, miembros con slug y descripción, límites, y el constructor con diagrama vivo (§11).
  *Acepta:* el coordinador no puede ser miembro de su propio grupo; los slugs son únicos; el diagrama refleja los cambios en vivo; test cross-tenant (no se pueden sumar agentes de otro workspace).
- **WP-56 — Motor de orquestación.** Depende de WP-30, WP-40, WP-50 y WP-55. **Riesgo alto.**
  Herramientas `delegate_*`, ejecuciones hijas, paralelismo (3), presupuesto y máximo de delegaciones, aprobaciones que suben a la raíz, eventos de delegación y UI de ejecución de grupo (§5).
  *Acepta:* con el proveedor faux, un coordinador delega en dos miembros en paralelo y combina sus respuestas; al pasar el presupuesto termina con `limit_reached`; una aprobación en una hija pausa la raíz y la retoma; los miembros no pueden delegar.
- **WP-57 — Plantilla "Mi día" de punta a punta.** Depende de WP-51, WP-53, WP-54 y WP-56.
  Grupo plantilla con coordinador "Jefe de agenda" y tres miembros: "Lector de calendario" (con `google_calendar_events`), "Priorizador" y "Redactor". Tarea programada de lunes a viernes a las 7:30 en la zona del usuario, con entrega por email y WhatsApp.
  *Acepta:* E2E con Google y WhatsApp falsos: la tarea corre, el grupo lee los eventos del día, arma tareas y sugerencias, y quedan dos entregas `sent`.

### Hito 6: Uso, costos y pulido
- **WP-60 — Uso y dashboard.** Depende de WP-30. REQ-26, REQ-27.
  *Acepta:* el costo por conversación y por día coincide con la suma de `usage_record`; gráficos por agente, proveedor y modelo.
- **WP-61 — Límites de gasto.** Depende de WP-60. REQ-28 (Could).
- **WP-62 — Onboarding.** Depende de WP-21 y WP-31. REQ-29.
  *Acepta:* E2E que llega del registro al primer mensaje del agente.
- **WP-63 — Pulido de UI.** Depende del resto de la UI. REQ-30.
  *Acepta:* todas las pantallas tienen estados de carga, vacío y error; axe sin violaciones serias.

### Hito 7: Lanzamiento del MVP
- **WP-70 — Producción.** Depende de WP-05; se cierra al final. **Riesgo alto.** REQ-31.
  `compose.prod.yaml`, Caddy con HTTPS, deploy, migraciones, backups cifrados, restauración probada, logs, alertas (Sentry opcional) y runbooks.
  *Acepta:* deploy desde cero en un VPS limpio siguiendo solo el runbook; restauración de backup probada.
- **WP-71 — Páginas legales.** Depende de WP-04. REQ-34.
  Rutas `/terms` y `/privacy` que muestran el texto que entrega Ale, explicando el tratamiento de las API keys.
- La **landing**, la propuesta de valor, la beta, el feedback y los precios (REQ-32, 33, 35, 36, 37) son de Ale y no bloquean el trabajo de los agentes.

### Carriles en paralelo

```
Carril A (núcleo):    WP-00 → WP-02 → WP-06 → WP-11 ─┐
Carril B (cuentas):   WP-01 → WP-03 → WP-04 → WP-10 ─┴→ WP-12 → WP-13 → WP-20 → WP-30
Carril C (CI/infra):  WP-05 ……………………………………………………………………………………………→ WP-70
Después de WP-30:     WP-31 → WP-32 / WP-33   |   WP-34   |   WP-40 → (WP-41 ‖ WP-42 ‖ WP-43 ‖ WP-44)
Después de WP-40:     WP-50 → (WP-51 ‖ WP-52 ‖ WP-54)   |   WP-53   |   WP-60 → WP-61   |   WP-62 → WP-63
Grupos:               WP-07 → WP-55 (con WP-20) → WP-56 (con WP-50) → WP-57 (con WP-51, WP-53, WP-54)
Diseño:               WP-07 corre en paralelo con WP-01 a WP-03 y antes de WP-04
```

**Pedir temprano:** la verificación de la app en Google (Q9) y la cuenta de WhatsApp Business con su plantilla (Q10) tardan días o semanas y no dependen del código. Arrancarlas apenas haya dominio y política de privacidad.

---

## 16. Preguntas abiertas (no las decidas: usá el valor por defecto y marcá `TODO(decision)`)

| # | Pregunta | Valor por defecto mientras tanto | Quién decide |
| --- | --- | --- | --- |
| Q1 | Nombre definitivo y dominio | `APP_NAME = "Middleware"` y dominio de desarrollo `localhost` | Luca y Ale |
| Q2 | Idioma de la UI para el lanzamiento | Español rioplatense, preparado para inglés | Ale |
| Q3 | Proveedor de email transaccional (verificación, recuperación, avisos y **entregas**). Ahora es necesario para el MVP | Interfaz `Mailer` con adaptador SMTP y consola en desarrollo | Luca |
| Q4 | Proveedor de VPS (y si tiene KVM para gondolin) | Ninguno; documentar requisitos de §14 | Luca |
| Q5 | Búsqueda web: ¿solo key del usuario o también una key nuestra con límite gratuito? | Solo key del usuario | Luca y Ale |
| Q6 | Límites por defecto por workspace (ejecuciones, tareas, tokens) | Los de §5 | Ale (relación con precios) |
| Q7 | Público objetivo y plantillas finales | Las 6 plantillas de WP-21 | Ale |
| Q8 | ¿Gondolin entra al MVP? | No; WP-45 queda opcional | Luca |
| Q9 | Verificación de la app en Google (permisos sensibles `calendar.readonly` y `gmail.send`): requiere dominio propio, política de privacidad publicada y un video de uso | Modo prueba con los usuarios de prueba cargados en la consola de Google | Luca (técnico) y Ale (textos legales) |
| Q10 | WhatsApp Business: cuenta de Meta verificada, número de la empresa y aprobación de la plantilla `resumen_listo`. Cada plantilla enviada se cobra; definir si se incluye en el precio | Adaptador WhatsApp desactivado por flag hasta tener credenciales; en desarrollo, un adaptador de consola | Luca y Ale |
| Q11 | ¿Modos "cadena de pasos" y "paralelo con combinación" para grupos? | Fuera del MVP; `agent_group.mode` ya los reserva | Luca |

---

## 17. Definición de terminado del MVP

- Todos los WP de los hitos 1 a 7 marcados como Must están mergeados, y sus requisitos de Notion están en **Listo**.
- Un usuario nuevo puede, sin ayuda:
  1. registrarse;
  2. cargar una key;
  3. crear un agente desde una plantilla;
  4. chatear con streaming;
  5. usar búsqueda web, una API HTTP y un servidor MCP;
  6. ejecutar código;
  7. programar una tarea diaria y aprobar una acción;
  8. conectar Google, armar un grupo con coordinador desde la plantilla "Mi día" y recibir cada mañana, por email y WhatsApp, las tareas del día con sugerencias;
  9. llamar a su agente o a su grupo por la API pública;
  10. ver cuánto gastó, por agente y por grupo.
- La suite de seguridad de §14 está en verde, y el revisor independiente aprobó los WP de riesgo alto.
- Producción corre en el VPS con HTTPS, backups probados y runbooks.

---

## 18. Variables de entorno

| Variable | Dónde | Descripción |
| --- | --- | --- |
| `DATABASE_URL` | api, worker, migrate | Conexión a Postgres |
| `MW_MASTER_KEY`, `MW_MASTER_KEY_VERSION` | api, worker | Clave maestra (S1) |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | api | Better Auth |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | api | Login con Google |
| `GOOGLE_INTEGRATION_CLIENT_ID`, `GOOGLE_INTEGRATION_CLIENT_SECRET` | api, worker | Integración con Calendar y Gmail (pueden ser el mismo cliente OAuth que el login) |
| `MAIL_FROM`, `MAIL_PROVIDER_*` | api, worker | Remitente y credenciales del proveedor de email (Q3) |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_RESUMEN` | api, worker | WhatsApp Cloud API (Q10); sin ellas, el canal queda desactivado |
| `APP_URL` | web, api | URL pública, por ejemplo `https://app.<dominio>` |
| `API_INTERNAL_URL` | web | URL interna de la API para los Server Components |
| `SMTP_URL` | api, worker | Email (Q3) |
| `MW_SANDBOX_VM` | api, worker | `1` habilita gondolin (S7) |
| `MW_LIMIT_*` | api, worker | Límites de §5 |
| `SENTRY_DSN` | todos (opcional) | Errores |
| `LOG_LEVEL` | todos | `info` por defecto |

**Prohibidas** en api y worker: cualquier variable de key de proveedor de modelos (S3).

---

## 19. Referencias

- Gentleman Programming: [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai), [engram](https://github.com/Gentleman-Programming/engram), [gentleman-guardian-angel](https://github.com/Gentleman-Programming/gentleman-guardian-angel), [Gentleman-Skills](https://github.com/Gentleman-Programming/Gentleman-Skills), [gentleman-architecture-agents](https://github.com/Gentleman-Programming/gentleman-architecture-agents), [gentle-shell](https://github.com/Gentleman-Programming/gentle-shell), [gentle-dot](https://github.com/Gentleman-Programming/gentle-dot) (referencia de conectores con aprobaciones y protocolo de streaming).
- Pi (earendil-works): [repositorio](https://github.com/earendil-works/pi); paquetes `@earendil-works/pi-ai`, `pi-agent-core`, `pi-mcp`, `pi-codemode`, `gondolin` y `pi-durable` en npm.
- Referencia de producto: [LibreChat](https://github.com/danny-avila/LibreChat) (agentes, MCP, multiusuario).
- Alternativa evaluada: [Vercel AI SDK 7](https://vercel.com/blog/ai-sdk-7).
- Google: clasificación de permisos y verificación, [guía de Nylas sobre scopes de Google](https://developer.nylas.com/docs/cookbook/use-cases/build/google-oauth-scopes/) y la documentación oficial de OAuth de Google.
- WhatsApp: [precios y ventana de servicio de la WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md).
- Diseño: maquetas en `docs/design/mockups/` (también en el lienzo "Middleware: direcciones visuales" de Luca en claude.ai, privado).
- Notion del proyecto: hub "Middleware", con las bases "Hitos del MVP" y "Requisitos y roadmap".
