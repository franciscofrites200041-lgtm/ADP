# ADR-0009: WhatsApp a través de una empresa verificada, no con cuenta propia

- **Estado:** aceptado
- **Fecha:** 2026-11-24
- **Contexto:** Q10 del maestro (§16) asume que Middleware abre su propia cuenta
  de WhatsApp Business en Meta: verificación de la empresa, número exclusivo de
  la empresa y aprobación de la plantilla `resumen_listo`. La verificación de
  Meta depende de papeles de la empresa y tarda días o semanas, y la aprobación
  de plantillas puede rechazarse. El dueño del producto resolvió que los
  mensajes salgan por una **empresa ya verificada** que actúa como proveedor, en
  lugar de abrir cuenta propia.

## Decisión

La entrega por WhatsApp usa la cuenta de WhatsApp Business de la empresa
proveedora verificada, con sus credenciales y su número. Middleware no abre
cuenta propia de Meta en este alcance.

La frontera técnica no cambia: sigue habiendo un puerto `WhatsApp` con dos
adaptadores, el de consola en desarrollo y el real, y el dominio no sabe por
quién pasa el mensaje. Lo que cambia son las credenciales, el número de origen y
quién administra la plantilla `resumen_listo`.

## Consecuencias que hay que decir en voz alta

- **El mensaje sale del número de la empresa proveedora, no de Middleware.** Para
  quien lo recibe, el remitente es otro. Es aceptable en una demo y en un uso
  interno; si el producto crece, la marca del remitente pasa a importar.
- **La plantilla la administra el proveedor.** Un cambio de redacción no es un
  cambio nuestro: depende de sus tiempos y de su aprobación ante Meta.
- **El costo por mensaje lo fija y lo cobra el proveedor**, con su margen. No es
  el precio de lista de Meta.
- **Dependencia de un tercero.** Si el proveedor cambia sus condiciones, corta el
  servicio o deja de ser verificable, el canal se cae y no hay plan B propio. La
  mitigación es que el canal está detrás de un puerto y detrás de un flag: apagarlo
  deja el resto del producto intacto.
- **Si el proveedor es una empresa conocida, la relación es personal.** Conviene
  que el acuerdo —número, plantilla, precio, qué pasa si se corta— esté por
  escrito antes de que la demo dependa de él. Un compromiso verbal es un punto
  único de falla con nombre de persona.

## Lo que no cambia

El cumplimiento de la ventana de 24 horas, el uso de plantilla *utility* fuera de
la ventana, el webhook firmado y la idempotencia por reintento siguen siendo
nuestros: son reglas de Meta y del contrato de §5, y pasan igual aunque el
número sea de otro.
