# ADR-0003: Adaptar el código previo y desplegar solo en el VPS

- **Estado:** aceptado
- **Fecha:** 29 de octubre de 2026
- **Decide:** Luca
- **Reemplaza:** la decisión de reinicio desde cero y el despliegue en Vercel + Supabase de la versión 2.0 del maestro
- **Relacionado:** D3, D4, D9, D15 y D21 de `MAESTRO_PLATAFORMA.md` v3.0; §15.0

## Contexto

La versión 2.0 del maestro tomó dos decisiones:
- reiniciar el proyecto desde cero, porque el código generado no alcanzaba el nivel buscado;
- desplegar el mismo código en dos destinos: el VPS para producción y Vercel + Supabase para las demos.

Al revisarla, los agentes que construyen el proyecto propusieron:
- adaptar y reutilizar el código previo en vez de reiniciar;
- quitar Vercel + Supabase del alcance.

Además, WP-06 (cifrado envolvente) está en curso sobre el código previo.

## Decisión

1. **El código previo se adapta, no se reinicia.**
   - Primero una auditoría (WP-A0) deja en `docs/adaptacion.md` qué se conserva, qué se adapta y qué se rehace, con el motivo.
   - Se rehace solo lo que viola las reglas de seguridad (§8) o lo que cuesta más adaptar que escribir de nuevo.
2. **La calidad se exige igual,** pero sobre el código previo con una línea base (`quality-baseline.json`) que solo puede bajar. El código nuevo cumple todas las reglas de §13 sin excepciones.
3. **Un solo destino: el VPS.** Tiene dos entornos:
   - demo, que recibe cada merge a `main` y es donde se le muestra a Ale;
   - producción, que se despliega por tag.

   Vercel y Supabase quedan fuera del alcance, y `MAESTRO_VERCEL.md` deja de aplicar.
4. **La estructura vuelve a `apps/api` + `apps/worker`.** Las dependencias se arman con `createContainer(env)` en `packages/adapters`. Se eliminan `packages/api`, `packages/runtime` y `MW_TARGET`.
5. **WP-06 sigue en curso** sobre el código existente.

## Se mantiene de la versión 2.0

- Reglas de calidad verificadas por herramientas (D22).
- Rebanada de referencia (WP-10) y contratos primero.
- "Iniciar y transmitir" (D15).
- `tick(now)` propio.
- Resend.
- Tests de integración sin Testcontainers.

## Consecuencias

- No se pierde el trabajo hecho, y WP-06 no se frena.
- Desaparece todo lo propio de Vercel:
  - el corte por duración y el reencolado;
  - la función de drenado con `fetch()`;
  - los poolers de Supabase;
  - el esquema `app` obligatorio;
  - el evento `run.detached`;
  - los WP-V1 y WP-V2.
- Para mostrarle la demo a Ale hace falta el VPS y un dominio antes (Q1, Q4). WP-08 cubre ese entorno.
- Convivir con código que no cumple todas las reglas es un costo. La línea base lo hace visible y obliga a que baje con cada PR.
