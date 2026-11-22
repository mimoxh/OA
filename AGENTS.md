<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes (agents)

- Run node/pnpm/prisma from Windows PowerShell 7 (`pwsh`), not WSL: `better-sqlite3` is a native module.
- `pnpm dev` starts three processes: web :3000, collab (Hocuspocus) :1234, realtime (ws) :1235. Verify with `pnpm typecheck` and `pnpm lint`.
- Prisma 7 refuses destructive commands (`db:reset` / `--force-reset`) when an AI agent runs them; the user has to run those. Schema changes are additive via `pnpm db:push`; `pnpm db:seed:im` is idempotent (IM demo data + bot-card backfill + fixups).
- For E2E, use an isolated instance (`DATABASE_URL=file:./prisma/p1test.db`, `NEXT_DIST_DIR=.next-p1`, `SESSION_COOKIE_NAME=oa_session_p1`, separate ports). Afterwards run `git checkout -- tsconfig.json`, because typegen adds `.next-p1` includes to it.
- IM architecture and the Postgres / multi-instance notes are in `docs/DEVELOPMENT.md`.
