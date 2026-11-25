# Dónde arrancar

Estado al **2026-11-24**, HEAD `bef234f` en `main`, CI verde.

## Lo que está hecho y en `main`

- WP-14 (protección SSRF con DNS rebinding cerrado) — cerrado.
- WP-30 (motor de ejecución + SSE) — **en `main`, con cuatro correcciones
  pendientes de commitear** (ver abajo).
- WP-08 — artefactos escritos y `compose config` validado. Bloqueado por VPS y
  dominio, que el dueño decidió dejar para cuando la app esté lista.
- Q9 y Q10 resueltas por el dueño → ADR-0008 y ADR-0009, y §16 del maestro
  actualizado para apuntar a ellas.

## Lo primero que hay que hacer al retomar

Tres workers estaban en vuelo al cerrar. **Antes de cualquier otra cosa, mirar
si Volvieron y commitear:**

1. `mwvfxsj9-k-swgz` — motor: invariante evento-antes-de-estado, `finish`
   condicional, tope de 5 ejecuciones simultáneas por workspace, `params` al
   `Agent`, tests de carrera de lease y de los temporizadores.
2. `mwvfxsqf-l-xq6t` — rutas: cerrar el stream ante fila terminal sin evento,
   copia en español de `run.failed`, filtro `agentId` en SQL.
3. Los dos ADR y el maestro ya están escritos en el árbol, sin commitear.

Si los dos primeros no volvieron: `subagent_status` con esos ids. Están
relanzables desde el brief del traspaso de memoria (obs. 588).

**Protocolo de commit que no se negocia** (costó tres commits contaminados):

```bash
git reset -q                     # el índice sobrevive a un commit rechazado
git add <rutas explícitas>
git commit -m "..."              # el GGA revisa TODO el árbol: no commitear
                                 # mientras un worker escribe
```

## Inmediatamente después

**WP-31 — pantalla de chat.** La API ya transmite y se reconecta; falta la web.
Lo que hay que probar que funciona, en este orden:

1. Escribir, enviar, ver la respuesta aparecer mientras llega.
2. **Recargar la página a mitad de la respuesta y no perder texto.** Es el
   criterio de aceptación de la Demo 1 y el que más se olvida.
3. Un error de proveedor se ve como frase en español, no como código.

Después WP-32 (historial: la base paginada ya existe, falta la UI y
`createConversationService` en core, porque hoy las rutas de conversación
orquestan repositorios directamente) y WP-33 (catálogo de errores: faltan
`integration_needs_reauth` y `delivery_failed` de los 14).

## Deuda registrada, con motivo

| Deuda | Por qué no está | Cuándo |
|---|---|---|
| Resume tras crash lee el checkpoint | `output` puede quedar vacío y `run.completed` duplicarse; la recuperación es WP-50 | WP-50, con el test que lo pruebe |
| Test de §8 que escanea la key en **todos** los logs y tablas | Hoy escanea eventos, bus y runtime | Antes de la Demo 2 |
| `/api/runs?agentId=` filtraba después del page de 100 | En corrección (worker 2) | Este commit |
| `signup.integration.test.ts` con copia del guard de base | Fuera de las superficies permitidas del worker | Cualquier PR de `apps/api` |
| Advisory de GGA: rotación a mitad de loop, `shutdown` ignorando `close`, payloads sin Zod | Código previo, no de esta tanda | Al tocar esos archivos |

## Trampas de esta máquina

- **OneDrive corrompe `.git`.** Ya pasó dos veces: objetos perdidos, índice
  inválido. Si aparece `invalid object … Error building trees`:
  `rm -f .git/index && git reset -q` (no toca el árbol de trabajo). **La
  solución de fondo es sacar el repo de OneDrive, y es decisión del dueño.**
- **`next dev` no hidrata acá.** Usar build de producción + `next start`; sirve
  un build congelado, así que un cambio de UI exige reconstruir.
- **En este bash los apóstrofes y backticks rompen `node -e`.** Usar la
  herramienta de edición o escribir un archivo.
- **Base descartable** en `127.0.0.1:55432`, usuario `mw_test`, base
  `middleware_test`. Se recrea con los binarios de PostgreSQL 18 si el temporal
  se limpia.
- **El GGA no corre tests.** Verde en la revisión no significa verde en la suite.

## Lo que espera al dueño, no al código

- **Sacar el repo de OneDrive** (lo más urgente de esta lista).
- Q7: contenido final de las 6 plantillas, según el público que elija Ale. Las
  instrucciones actuales las escribió el agente: son usables, no definitivas.
- WP-08: VPS y dominio, cuando la app esté lista.
- Desconectar Vercel (no aplica por ADR-0003).
