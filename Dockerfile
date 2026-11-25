# syntax=docker/dockerfile:1

# 阶段 1：构建 Next standalone + 协同 / 实时 / 单端口网关产物
# 选用 node:22-bookworm-slim（Debian glibc）：
#   1) 满足 better-sqlite3@13.2.0 的 Node >= 22 引擎要求；
#   2) 兼容 linux/amd64（如飞牛 NAS N150/N100/J4125）与 linux/arm64，优先命中预编译原生插件，
#      并仅在构建阶段预装 python3/make/g++ 作为源码编译兜底。
FROM node:22-bookworm-slim AS builder

ARG PNPM_VERSION=11.21.0
WORKDIR /src

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_STRICT=0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

# 先复制锁文件与 Prisma Schema 以复用依赖层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY desktop/package.json ./desktop/package.json
COPY prisma/schema.prisma ./prisma/schema.prisma

# Prisma 7 postinstall（prisma generate）会读取 prisma.config.ts 中的 DATABASE_URL
ENV DATABASE_URL="file:./prisma/build.db"
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile --filter oa-suite

# 复制运行构建所需源码、静态资源（含 public/agent-icons/*.png）与 SQLite 迁移脚本
COPY . .

RUN node scripts/docker/bundle-server.mjs --out /app/standalone

# 阶段 2：精简运行镜像（无编译工具链与开发依赖）
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    OA_PORT=3000 \
    OA_BIND=0.0.0.0 \
    OA_DATA_DIR=/data \
    DATABASE_URL=file:/data/db/oa.db \
    ATTACHMENT_DIR=/data/attachments \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_DIR=/data/uploads \
    COLLAB_PUBLIC_URL=/collab \
    REALTIME_PUBLIC_URL=/rt

COPY --from=builder /app/standalone ./
COPY scripts/docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# 清除 Windows 检出可能引入的 CRLF 并预建挂载目录
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /data/db /data/attachments /data/uploads

EXPOSE 3000
VOLUME ["/data/db", "/data/attachments", "/data/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const p=process.env.OA_PORT||process.env.PORT||3000;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "oa-standalone.mjs"]
