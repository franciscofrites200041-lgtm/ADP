# ADR-0007: Barrido de ejecuciones huérfanas como lectura a nivel de sistema

- **Estado:** aceptado
- **Fecha:** 2026-11-02
- **Contexto:** cuando un proceso se cae (deploy o crash), la ejecución que
  tenía a su cargo queda `running` con un `lease_until` vencido. Alguien tiene
  que encontrar esas filas para reencolarlas con `run.resume` (§5, el tick).
  Esa búsqueda no puede pedir un `workspaceId`: el tick es un trabajo de
  sistema y no hay sesión con la cual acotarla. `AGENTS.md` permite una única
  excepción al scoping sin ADR (el catálogo global de plantillas de agente), y
  esta lectura no entra en ella.

## Decisión

El barrido es un puerto propio, `RunSweeper`, separado de `RunRepo`, con un
único método: `listExpiredLeases(now)`. No recibe ni usa `workspaceId`, porque
el tick no tiene sesión con la cual acotar, y devuelve **solo pares
`{ workspaceId, runId }`**: la consulta selecciona únicamente las columnas de
identificación, de modo que el barrido no puede traer consigo el `input`, el
`output` ni los errores de las ejecuciones que encuentra. `RunRepo` queda
enteramente acotado por workspace, sin excepciones.

La implementación vive en el mismo pool de conexiones del contenedor
(`createRunSweeper(db)`), y su único consumidor previsto es el tick del worker
(WP-50).

## Alternativas consideradas

- **Recorrer workspace por workspace** con la lista de workspaces conocidos:
  necesita una fuente de workspaces (otra lectura global, la misma excepción
  con otro disfraz), un loop N+1 contra la base y sigue sin cubrir workspaces
  creados entre dos lecturas. Más código, mismo problema.
- **Una tabla de tareas del tick con columna `workspace_id`**: movería el
  estado del barrido a una tabla espejo que hay que mantener sincronizada con
  `run`; el vencimiento del lease seguiría viviendo en `run`, así que la tabla
  espejo sería una copia que puede quedar desactualizada justo cuando el
  sistema está caído, que es el caso que importa.

## Consecuencias

- La excepción al scoping queda explícita en un puerto con nombre y un ADR, no
  escondida como un método más de un repositorio acotado.
- El resultado del barrido es mínimo por construcción: identificadores
  solamente, nunca contenido de ejecución.
- El tick reencola con `run.resume` usando el `workspaceId` del par, y cada
  ejecución retoma desde su checkpoint (WP-50).
- Si en el futuro el barrido pasa a `LISTEN/NOTIFY` o a otra mecánica, cambia
  el adaptador, no el contrato: el puerto solo promete pares de
  identificadores de ejecuciones con lease vencido.
