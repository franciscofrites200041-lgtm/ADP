# ADR-0006: Integración con un Postgres desechable en vez de Testcontainers

- **Estado:** aceptado
- **Fecha:** 2026-11-02
- **Contexto:** `AGENTS.md` y el maestro (§14) piden Testcontainers para los tests de
  integración. Testcontainers necesita un motor de contenedores.

## Decisión

Los tests de integración corren contra un Postgres real ya provisionado, no contra uno
levantado por Testcontainers. El arnés toma `DATABASE_URL_TEST` y **rechaza cualquier
base que no sea `127.0.0.1/middleware_test`**, así que no puede apuntar a una base de
desarrollo o de producción por error.

Si `DATABASE_URL_TEST` falta, las suites de integración **fallan fuerte** (salvo
`MW_SKIP_INTEGRATION=1` explícito). Nunca se saltean en silencio.

## Por qué

El dueño del producto rechazó Docker explícitamente al iniciar la adaptación, y
Testcontainers lo requiere. En lugar de abandonar la cobertura de integración —que es
donde aparecen los errores de tenencia— se mantiene un Postgres real, en un clúster
descartable del propio equipo, y el CI levanta un servicio de Postgres efímero de
Actions, que cumple la misma función que el contenedor.

La cobertura se conserva: casos cross-tenant, redacción de secretos, migraciones y
restricciones reales de la base. Lo único que cambia es quién levanta el motor.

## Consecuencias

- El CI corre las suites de integración contra el servicio `postgres:18` de Actions,
  creando `middleware_test` y migrando antes de la suite.
- Un desarrollador necesita el clúster local en `127.0.0.1:55432` (o el puerto que
  elija) y exportar `DATABASE_URL_TEST`.
- El guard del arnés es parte de la seguridad de la suite: impide correr contra una
  base que no sea descartable.
- Si en el futuro se habilita Docker, este ADR se reemplaza y el arnés puede pasar a
  Testcontainers sin tocar los tests, porque el punto de entrada sigue siendo una URL.
