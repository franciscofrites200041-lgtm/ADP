# Rotar la clave maestra (KEK)

Cubre S1 de `MAESTRO_PLATAFORMA.md` §8. La KEK (`MW_MASTER_KEY`) envuelve las DEK de `workspace_key`; los secretos no se tocan, solo se re-envuelven las DEK.

El script recorre **todos** los workspaces a propósito: es una operación de operador, no un repositorio con alcance por workspace, así que es la excepción documentada a la regla "`workspaceId` primero" (S4).

## Variables

| Variable | Contenido |
|---|---|
| `MW_MASTER_KEY` | KEK vigente: 32 bytes en base64. |
| `MW_MASTER_KEY_VERSION` | Etiqueta de la KEK vigente (ej. `v2`). Se guarda en `workspace_key.kek_version`. |
| `MW_MASTER_KEY_PREVIOUS` | Solo durante la rotación: KEK viejas como `version:base64`, separadas por coma. |

Nunca guardes la KEK en la base, en el repo ni en logs.

## Procedimiento

1. Generá la KEK nueva: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Guardala en el gestor de secretos junto con la vieja.
2. Desplegá api y worker con `MW_MASTER_KEY` nueva, `MW_MASTER_KEY_VERSION=v2` y `MW_MASTER_KEY_PREVIOUS=v1:<KEK vieja>`. Las DEK con `kek_version=v1` se siguen leyendo; las nuevas se envuelven con `v2`.
3. Drená las instancias viejas (api y worker que no conocen `v2`) antes de re-envolver: una instancia sin `v2` no puede leer filas ya rotadas. Confirmá que ninguna sigue recibiendo tráfico ni jobs.
4. Corré el script con las mismas variables más `DATABASE_URL` (nada por argumentos, para que no queden en el historial ni en `ps`):

   ```
   pnpm --filter @middleware/adapters rotate:keys
   ```

   Imprime `{"scanned","rotated","skipped"}`. Cada fila se actualiza con un único `UPDATE` que compara `workspace_id`, la `kek_version` anterior y el `wrapped_dek` exacto leído. Si otra escritura cambió la fila, el script aborta con código de salida 1 sin pisar la DEK más nueva. Es idempotente: se puede volver a correr. La salida y los errores nunca incluyen claves ni la URL de la base. Los secretos cifrados no cambian: la DEK es la misma, solo cambia su envoltorio.
5. Verificá: `select count(*) from workspace_key where kek_version <> 'v2'` debe dar 0.
6. Redesplegá sin `MW_MASTER_KEY_PREVIOUS` para el tráfico en vivo. **No destruyas la KEK vieja** mientras exista algún backup cifrado de la base tomado antes de la rotación: ese backup contiene DEK envueltas con `v1` y solo se restaura con `v1`. Conservá cada KEK (en el gestor de secretos, nunca en la base ni en el repo) durante todo el período de retención de los backups que la usan, y destruila recién cuando expire el último.

## Si algo falla

- El script aborta por cambio concurrente: la fila modificada no se pisa, pero las filas anteriores pueden haber quedado rotadas. Conservá ambas KEK, revisá que no queden instancias viejas escribiendo `workspace_key` y volvé a correrlo.
- Volver atrás (rollback) necesita **la KEK vieja y la nueva**: las filas rotadas están en `v2` y las no rotadas en `v1`, así que ambas versiones deben estar en el keyring mientras se redesplega la versión anterior.
- Una fila con versión desconocida falla con `UNKNOWN_KEK_VERSION`; no la borres, restaurá la KEK de esa versión.
- Restaurar un backup anterior a la rotación requiere la KEK vieja; si ya la destruiste, esas DEK no se recuperan.
