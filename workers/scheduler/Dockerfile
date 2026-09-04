# workers/scheduler — BullMQ worker
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/facebook-core/package.json packages/facebook-core/
COPY workers/scheduler/package.json workers/scheduler/
RUN pnpm install --frozen-lockfile --filter @fbpm/worker-scheduler...

FROM deps AS build
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY packages/facebook-core packages/facebook-core
COPY workers/scheduler workers/scheduler
RUN pnpm --filter @fbpm/shared build \
 && pnpm --filter @fbpm/database build \
 && pnpm --filter @fbpm/facebook-core build \
 && pnpm --filter @fbpm/worker-scheduler build \
 && pnpm --filter @fbpm/worker-scheduler... deploy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN mkdir -p /app/data/media && chown -R node:node /app
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/workers/scheduler/dist ./dist
USER node
CMD ["node", "dist/main.js"]
