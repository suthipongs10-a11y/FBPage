# workers/scheduler — BullMQ worker
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN apk add --no-cache openssl
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/facebook-core/package.json packages/facebook-core/
COPY packages/youtube-core/package.json packages/youtube-core/
COPY packages/web-core/package.json packages/web-core/
COPY packages/email-core/package.json packages/email-core/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/tiktok-core/package.json packages/tiktok-core/
COPY packages/messenger-core/package.json packages/messenger-core/
COPY workers/scheduler/package.json workers/scheduler/
RUN pnpm install --frozen-lockfile --filter @fbpm/worker-scheduler...

FROM deps AS build
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY packages/facebook-core packages/facebook-core
COPY packages/youtube-core packages/youtube-core
COPY packages/web-core packages/web-core
COPY packages/email-core packages/email-core
COPY packages/ai-core packages/ai-core
COPY packages/tiktok-core packages/tiktok-core
COPY packages/messenger-core packages/messenger-core
COPY workers/scheduler workers/scheduler
RUN pnpm --filter @fbpm/shared build \
 && pnpm --filter @fbpm/database build \
 && pnpm --filter @fbpm/ai-core build \
 && pnpm --filter @fbpm/facebook-core build \
 && pnpm --filter @fbpm/youtube-core build \
 && pnpm --filter @fbpm/web-core build \
 && pnpm --filter @fbpm/email-core build \
 && pnpm --filter @fbpm/tiktok-core build \
 && pnpm --filter @fbpm/messenger-core build \
 && pnpm --filter @fbpm/worker-scheduler build \
 && pnpm --filter @fbpm/worker-scheduler deploy --legacy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache openssl && mkdir -p /app/data/media && chown -R node:node /app
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/workers/scheduler/dist ./dist
USER node
CMD ["node", "dist/main.js"]
