# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## ChatGPT Auto-Register: Key Findings & Status

### Registration Flow (WORKING ✅)
- **Full flow confirmed**: `chatgpt.com signup → OTP auto-retrieval (mail.tm, ~5s) → about-you → chatgpt.com` — complete in under 2 minutes
- **OTP handling**: mail.tm temp email API; OTP arrives in ~4 seconds
- **About-you page**: Uses React Aria spinbuttons (role="spinbutton") for birthday + JS `element.focus()` for name input + hidden `birthday` field override via native setter
- **Default password**: `Ppsmmgl@1919`

### Korea Promo Payment (IN PROGRESS 🔄)
- **Korea proxy**: `http://9C0MWyOEz370_custom_zone_KR_st__city_sid_77302828_time_0:2380911@change4.owlproxy.com:7778` — IP `121.182.99.44`, Gwangju/Seoul KR
- **Promo confirmed**: Plans page shows **"Claim offer"** and **"Free offer"** buttons ONLY when: (1) user authenticated + (2) Korean IP simultaneously
- **Critical fix**: Must open `chatgpt.com` FIRST to establish session in proxy context, THEN navigate to `/plans`
- **Onboarding modal**: "What brings you to ChatGPT?" appears after plans load — must dismiss with "Skip" before plan cards fully render
- **After Skip**: Use `waitForFunction` to wait for plan cards to re-appear (up to 20s)
- **Cloudflare Turnstile**: Repeated test runs from same proxy IP trigger Cloudflare bot challenge — in production each fresh registration = first visit to plans = no challenge
- **Stripe**: Has not been reached yet in automated test due to Cloudflare rate-limiting during development testing

### Key Files
- `artifacts/api-server/src/lib/manualRegistrationBot.ts` — main bot logic
- `artifacts/api-server/src/lib/registrationBot.ts` — batch registration
- `artifacts/api-server/src/routes/manual.ts` — manual registration routes
- `artifacts/api-server/src/scripts/testFullFlow.ts` — end-to-end test script
- `artifacts/chatgpt-auto-register/src/pages/settings.tsx` — settings UI

### doManualPayment Flow (UPDATED)
1. Create proxy BrowserContext (same browser instance) with Korea proxy
2. Copy session cookies
3. **[NEW]** Open `chatgpt.com` first to establish session, verify logged in
4. Navigate to `chatgpt.com/plans`
5. Dismiss onboarding modal ("What brings you to ChatGPT?" → Skip)
6. **[NEW]** `waitForFunction` to wait for "Claim offer" / plan cards to render
7. Click "Claim offer" or "Free offer" (Korea promo first, then Plus standard)
8. Poll for Stripe iframe (12 attempts, ~60s max)
9. Fill CC, expiry, CVV via `pressSequentially`
10. Set country to KR
11. Submit subscription

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
