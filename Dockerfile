ARG BASE_IMAGE=node:20-bookworm-slim
FROM ${BASE_IMAGE} AS base

FROM base AS deps
RUN if command -v apk >/dev/null 2>&1; then sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories; fi
RUN if command -v apk >/dev/null 2>&1; then apk add --no-cache libc6-compat python3 make g++ coreutils bash; else export DEBIAN_FRONTEND=noninteractive && apt-get -o Acquire::AllowInsecureRepositories=true -o Acquire::AllowDowngradeToInsecureRepositories=true -o APT::Update::Post-Invoke::= -o APT::Update::Post-Invoke-Success::= update && apt-get install -y --no-install-recommends --allow-unauthenticated ca-certificates debian-archive-keyring && apt-get -o APT::Update::Post-Invoke::= -o APT::Update::Post-Invoke-Success::= update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*; fi
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED 1
ARG BUILD_NODE_OPTIONS=--max-old-space-size=2048
ENV NODE_OPTIONS=${BUILD_NODE_OPTIONS}
RUN chmod +x node_modules/.bin/*

RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
