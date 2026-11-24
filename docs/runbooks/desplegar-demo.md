# Desplegar el entorno demo en el VPS

Runbook de WP-08. **Estado: escrito, sin ejecutar.** No hay VPS ni dominio todavía
(Q4 y Q1), así que nada de esto está probado en un servidor real. Cuando haya
servidor, este documento es el que se sigue y ahí se cierran los criterios de
`odd/tasks/wp-08.md`.

## Qué queda funcionando

Un merge a `main` con CI en verde construye dos imágenes, las publica en GHCR, entra
por SSH y deja `https://demo.<dominio>` sirviendo ese commit. Aplica migraciones antes
de levantar la aplicación y, si algo falla, vuelve a las imágenes anteriores. Nadie
toca el servidor a mano.

## Antes de empezar: lo que hay que tener

1. **VPS** con los requisitos de §14: Linux x86_64 o arm64, 4 vCPU, 8 GB de RAM,
   80 GB de disco, Docker y Compose v2.24 o superior (se usa más de un `--env-file`).
2. **Dominio** (Q1) con un registro `A` de `demo.<dominio>` apuntando a la IP del VPS.
   Sin esto Caddy no puede sacar el certificado.
3. **Secretos y variables en GitHub.** En *Settings → Secrets and variables → Actions*:
   - secretos: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`
   - variables: `DEMO_DOMAIN`, `DEPLOY_PATH`
4. **Clave de despliegue.** Un par de claves dedicado, con la pública en
   `~/.ssh/authorized_keys` del usuario de deploy. Ese usuario tiene que poder correr
   `docker`, es decir pertenecer al grupo `docker`: es equivalente a root, y así se
   asume.

## Preparación, una sola vez

```bash
# En el VPS, como el usuario de deploy:
sudo mkdir -p /opt/middleware/demo
sudo chown "$USER":"$USER" /opt/middleware/demo

# El archivo de secretos NO se copia desde el repositorio.
# Se escribe a mano en el servidor a partir de la plantilla:
cp /ruta/al/repo/infra/env.demo.example /opt/middleware/demo/env
chmod 600 /opt/middleware/demo/env
# y se completan todos los valores "replace-me", incluido APP_DOMAIN y
# BETTER_AUTH_URL=https://demo.<dominio>

# La clave maestra de cifrado (§8/S1) se genera en el servidor y no sale de ahí:
openssl rand -base64 32
```

`compose.prod.yaml`, `Caddyfile.prod` e `images.env` los deja el deploy en cada
ejecución. No se editan a mano en el servidor: si hace falta cambiarlos, se cambian en
el repositorio.

## Cómo se despliega

Nada que hacer: cada merge a `main` con CI en verde dispara
`.github/workflows/deploy-vps.yml`. El paso a paso que ejecuta está en
`.github/scripts/deploy-demo.sh` y hace, en orden:

1. anota las etiquetas actuales en `images.env.previous`;
2. `docker compose pull`;
3. `docker compose run --rm migrate` — **una migración rota corta acá**, con las
   imágenes anteriores todavía en pie;
4. `docker compose up -d --remove-orphans`;
5. prueba `https://<dominio>/readyz` hasta 60 segundos, que responde 200 solo si la
   base contesta;
6. si algo falló antes de este punto, restaura `images.env.previous` y vuelve a
   levantar.

## Verificar después de un deploy

```bash
ssh <usuario>@<host>
cd /opt/middleware/demo
cat images.env                                  # qué commit está corriendo
docker compose -p mw-demo --env-file env --env-file images.env -f compose.prod.yaml ps
curl -fsS https://demo.<dominio>/readyz         # 200 "ok"
```

## Si algo sale mal

**El deploy ya volvió solo.** Mirá los logs y arreglá hacia adelante:

```bash
docker compose -p mw-demo --env-file env --env-file images.env -f compose.prod.yaml logs --tail=200 migrate api
```

**Volver a mano a una versión anterior.** Poné las etiquetas que quieras en
`images.env` (cualquier tag publicado en GHCR) y levantá:

```bash
docker compose -p mw-demo --env-file env --env-file images.env -f compose.prod.yaml pull
docker compose -p mw-demo --env-file env --env-file images.env -f compose.prod.yaml up -d --remove-orphans
```

Esto funciona porque las migraciones son **solo aditivas** (§14): una columna se borra
en un PR posterior al que dejó de usarla, así que una imagen vieja convive con una base
nueva.

## Dos cosas que conviene tener presentes

**No hay artefacto compilado.** `apps/api` y `apps/worker` se ejecutan como TypeScript
directo con Node 24, igual que en desarrollo; la imagen no compila nada. Está anotado
como D-A en `odd/tasks/wp-08.md` y es la primera cosa a resolver si el arranque en el
servidor se porta distinto que en local.

**Docker se usa para desplegar, no para probar.** ADR-0006 descartó contenedores para
la base de los tests de integración; §14 los usa para el VPS. Son problemas distintos y
la regla no cambió.

## Lo que este runbook todavía no cubre

- **Backups y restauración:** son de WP-70, con el entorno de producción. Antes de
  usarlo con datos que importen, el volumen `postgres_data` necesita copia y
  restauración probada.
- **El entorno de producción** (`mw-prod`, `app.<dominio>`): mismo archivo de Compose,
  otro proyecto, otro `env` y deploy manual o por tag. Se arma en WP-70.
