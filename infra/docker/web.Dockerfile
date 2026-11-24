# syntax=docker/dockerfile:1
#
# Image for apps/web. Next.js needs its build step, so this Dockerfile is
# separate from the one that serves api and worker.
#
# No build argument for the API origin: the browser talks to `/api/*` on the
# same origin through Caddy, and Server Components read `API_INTERNAL_URL` at
# runtime (apps/web/src/env.ts), which compose sets to http://api:3001.
FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

RUN pnpm --filter @middleware/web build

FROM base AS runtime

ENV NODE_ENV=production

USER node

CMD ["pnpm", "--filter", "@middleware/web", "start"]
