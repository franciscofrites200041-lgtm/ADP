# syntax=docker/dockerfile:1
#
# One image for apps/api and apps/worker; the command decides which one runs
# (§5, WP-08 S6).
#
# D-A (odd/tasks/wp-08.md): this workspace does not emit a dist/ yet. `apps/api`
# and `apps/worker` declare `build: tsc --noEmit`, and both run TypeScript
# directly with Node 24, which strips types at load time. The image does the
# same, so it ships sources and the full install. Emitting real JavaScript is a
# separate decision; until then, "the image runs what development runs" is the
# only claim this file makes.
FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

# Sources are copied before install because every workspace package is resolved
# through node_modules links; a manifest-only layer would not install the same
# graph. The install stays cacheable per lockfile thanks to the pnpm store mount.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS runtime

ENV NODE_ENV=production

USER node

# Overridden by compose per service.
CMD ["node", "apps/api/src/index.ts"]
