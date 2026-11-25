# Dónde arrancar

> **El repo se mudó fuera de OneDrive.** Vive en `C:\dev\middleware-adp`. OneDrive
> corrompió `.git` tres veces: no es mala suerte, es un editor de archivos
> sincronizando un repo. La ruta vieja (`C:\Users\franc\OneDrive\Escritorio\
> Middleware ADP`) queda sólo como respaldo hasta que se borre.
>
> Si `git status` alguna vez muestra `Error building trees` o un objeto inválido,
> sospechá de la sincronización antes que de git.

Estado al **2026-11-25**, `main` en `fdcf576`, CI entero en verde (incluido el
navegador y `knip`). El MVP de la Demo 1 está completo y usable: te registrás,
cargás una key, creás un agente desde una plantilla y chateás viendo la respuesta
llegar — y podés recargar a mitad de la respuesta sin perder texto. La Demo 2 está
pleneada en `odd/tasks/demo-2.md`, tarea por tarea.

## Lo que está hecho

| WP | Qué | Commit |
| --- | --- | --- |
| WP-14 | Protección SSRF con DNS rebinding cerrado | `711e410` |
| WP-30 | Motor: lease, eventos con `seq`, checkpoint, límites, SSE | `1224d89`, `bef234f` |
| — | Ocho defectos de la verificación independiente, con prueba de mutación | `36bb199` |
| WP-31 | Pantalla de chat con streaming, recarga y cancelación | `ea0c567` |
| WP-33 | Catálogo de 14 errores, deduplicado a una sola fuente | `ea0c567` |
| — | Next 16.4.6 (16.4.3 ya no compila: la vulnerabilidad pasó a fatal) | `fce8d70` |
| WP-32 | Historial de conversaciones y servicio en core | `9287ae0` |
| — | Smoke de navegador en CI; Playwright levanta API y web | `dac1a0a` |

Números al cerrar: core 99, adapters 183, api 106, web 36, contracts 72, db 34.
Typecheck 9/9, lint 9/9, `arch` sin violaciones, 16 tests de navegador verdes.

## Lo primero que hay que mirar al retomar

**El primer CI con navegador.** El run `45714101494` se disparó con `dac1a0a` y es
la primera vez que Playwright corre en Actions: nunca se ejecutó ahí. Si falla, lo
más probable es el arranque de los servidores o el `MW_MASTER_KEY` generado en el
paso. El YAML está en `.github/workflows/ci.yml`, y `playwright.config.ts` levanta
los dos procesos.

```bash
gh run list --limit 3
gh run watch <id> --exit-status
```

**Protocolo de commit que no se negocia** (costó cuatro commits contaminados):

```bash
git reset -q                     # el índice sobrevive a un commit rechazado
git add <rutas explícitas>
git commit -m "..." -- <rutas>   # rutas también al final, sin excepción
```

## Lo que falta, en orden

1. **WP-40 y siguientes**: grupos, aprobaciones, herramientas. La Demo 2 necesita
   Google, email y WhatsApp; las decisiones Q9 y Q10 ya están en ADR-0008 y ADR-0009.
2. **Deuda de S12**: §8 pide un test que escanee la key en **todos** los logs y
   tablas después de una ejecución completa. Hoy se escanean eventos, bus y
   runtime, no todo.
3. **Recuperación de crash** (resume leyendo el checkpoint): es WP-50 y el código
   actual lo difiere a propósito. No está roto, está sin hacer.
4. **`signup.integration.test.ts`** conserva su propia copia del guard de base.
5. **Q7**: contenido final de las 6 plantillas, según el público que elija Ale.

## Deuda y trampas, con motivo

| Cosa | Por qué | Cuándo |
| --- | --- | --- |
| `knip` no corre en esta máquina | `oxc-parser` pide un buffer de 1 GiB que Windows no da; en CI pasa | CI decide |
| `next start` sirve un build congelado | Un cambio de UI exige reconstruir, o el e2e mira código viejo y pasa | Siempre |
| `next dev` no hidrata acá | Usar build de producción | Siempre |
| **OneDrive corrompe `.git`** | Ya pasó tres veces: objetos perdidos, `Error building trees`. Se arregla reescribiendo el blob (`git rm --cached` + `git add`) | **Decisión del dueño: sacar el repo de OneDrive** |
| `core.autocrlf=false` | Se normalizó para que el lint local coincida con Linux | Ya aplicado |
| Base descartable | `127.0.0.1:55432`, usuario `mw_test`. Si el temporal se limpia, recrear con los binarios de PostgreSQL 18 y migrar con `tsx src/cli.ts migrate <url>` | Según haga falta |

## Lo que espera al dueño, no al código

- **Sacar el repo de OneDrive.** Es la causa de todos los commits fantasma de esta
  semana. Lo más urgente de la lista.
- **VPS y dominio** para WP-08, cuando la app esté lista.
- **Q7**: las 6 plantillas. Las instrucciones actuales las escribió el agente: son
  usables, no definitivas.
- Desconectar Vercel (no aplica por ADR-0003).

## Correr los tests en esta máquina

`pnpm test` lanza las suites de todos los paquetes en paralelo y **se queda sin
memoria** (16 GB, 4 libres): los workers de vitest abortan con exit 134 y dejan
errores que mienten — «Invalid package config», por ejemplo, sobre un archivo que
es JSON válido. Cuando veas 134, `signal: aborted` o «heap out of memory», liberá
memoria y volvé a correr; no leas el error de arriba como diagnóstico.

Lo que funciona:

```bash
export DATABASE_URL_TEST="postgres://mw_test@127.0.0.1:55432/middleware_test"
pnpm turbo run test --concurrency=1                      # paquete por paquete
cd packages/adapters && npx vitest run --no-file-parallelism   # 183 tests, 21 s
```

En CI no hace falta: el runner tiene su cuota y turbo arranca con otro perfil.
