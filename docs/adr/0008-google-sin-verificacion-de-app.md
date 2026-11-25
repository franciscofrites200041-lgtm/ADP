# ADR-0008: Google sin verificación de app, en estado publicado

- **Estado:** aceptado
- **Fecha:** 2026-11-24
- **Contexto:** Q9 del maestro (§16) asume que la app se usa con desconocidos y
  por lo tanto necesita la verificación de Google para los permisos sensibles
  (`calendar.readonly`) y restringidos (`gmail.send`). El dueño del producto
  acotó el alcance: la aplicación la usan él y Ale, nadie más. Con ese alcance,
  la verificación —que para permisos restringidos incluye una auditoría de
  seguridad de terceros (CASA), se paga y tarda semanas o meses— no aporta nada
  mientras el público sean dos personas conocidas.

## Decisión

La app de Google Cloud queda **publicada (Production) y sin verificar**, con
tipo de usuario External. No se pide verificación.

Se usa **Production sin verificar**, no **Testing**, por una razón concreta y no
estética: en estado Testing Google emite *refresh tokens* que vencen a los
**7 días**, y la tarea programada de "Mi día" corre todos los días. Con Testing,
la integración de Google se rompería **cada semana** y habría que volver a
autorizar a mano; es la clase de falla que aparece recién en la tercera semana y
se diagnostica mal. En Production sin verificar la expiración de 7 días no
aplica.

El costo de esa elección es conocido y se acepta:

- Los usuarios ven la **pantalla de advertencia de app no verificada** antes de
  autorizar. Con dos usuarios conocidos es un paso más, no un riesgo de negocio.
- Hay un **tope duro de 100 usuarios totales**. No es un número que vayamos a
  rozar en este alcance, pero es un techo del producto: si algún día se abre a
  desconocidos, hay que verificar y el trabajo no es cero.

Consecuencia en el código: **ninguna**. El cliente OAuth vive detrás del mismo
puerto y el estado de verificación de Google no cambia una línea del repositorio.
Es una decisión de configuración de la consola, y por eso mismo queda escrita:
para que nadie la "arregle" pidiendo la verificación ni la degrade a Testing por
parecer más prolijo.

## Cuándo se revisa

Cuando el producto deje de ser para dos personas conocidas. En ese momento Q9
vuelve a estar abierta y la auditoría CASA pasa a ser un requisito con costo y
plazo propios, no un trámite.
