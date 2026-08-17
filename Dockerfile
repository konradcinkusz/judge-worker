# syntax=docker/dockerfile:1

# Multi-stage build: compile TypeScript with full devDependencies, then ship only the compiled
# dist/ output plus production dependencies in a slim runtime image. Every CLI in this repo
# (ingest/worker/calibrate/loadtest/dlq) is a plain Node script under dist/cli/ once built, so
# one image serves all of them -- see ENTRYPOINT/CMD below for how the default is chosen.

FROM node:22-alpine AS base
# Pins to the exact pnpm version recorded in package.json's packageManager field, the same one
# pnpm-lock.yaml was generated against, rather than whatever "pnpm" happens to resolve to.
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Small (~80KB) fixture/label files the default (mock, no API key) demo reads by default
# (fixtures/traces/*.json, data/calibration/human-labels.jsonl) -- see cli/ingest.ts and
# cli/calibrate.ts's own --dir/--labels defaults. Override those flags to use a real dataset
# instead of rebuilding the image.
COPY fixtures ./fixtures
COPY data ./data

# calibrate.js and loadtest.js write reports/<name>.json to the working directory -- give the
# non-root runtime user ownership of it now, rather than only what COPY's default root
# ownership would allow.
RUN addgroup -S judge-worker \
    && adduser -S judge-worker -G judge-worker \
    && chown -R judge-worker:judge-worker /app
USER judge-worker

# No API key needed for this default: MockJudgeProvider grades everything locally. Pass --live
# (and ANTHROPIC_API_KEY) to any of these to grade for real -- see README's Quick start.
ENTRYPOINT ["node"]
CMD ["dist/cli/worker.js"]
