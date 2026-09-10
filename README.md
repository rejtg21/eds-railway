# railway-event-driven

A minimal but real **event-driven system** you can run on [Railway](https://railway.app).

```
┌────────────┐   POST /api/orders   ┌─────────────────────────────────────────┐
│  web       │ ───────────────────▶ │  api  (NestJS)                          │
│  (Next.js) │                      │                                         │
│  [button]  │ ◀─ polls /orders ─── │  OrdersService.createOrder()            │
└────────────┘   & /debug/stats     │   └─ ONE Prisma $transaction:           │
                                    │        1. INSERT orders           ◀── transaction
                                    │        2. INSERT outbox_events (PENDING) ◀── outbox
                                    └───────────────┬─────────────────────────┘
                                                    │
                     ┌──────────────────────────────▼───────────────────────┐
                     │ OutboxRelayService  (poll loop OR manual /outbox/drain)│
                     │  SELECT ... FROM outbox_events WHERE status='PENDING' │
                     │  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT N   │
                     │  → EventBus.publish() → mark row PUBLISHED            │
                     └──────────────────────────────┬───────────────────────┘
                                                    │  pg-boss queue "order_created"
                     ┌──────────────────────────────▼───────────────────────┐
                     │ OrderCreatedConsumer                                 │
                     │  IdempotencyService.runOnce(consumer, eventId):      │ ◀── event + idempotency
                     │   ONE transaction:                                   │
                     │    - UPDATE orders SET status='CONFIRMED'            │
                     │    - INSERT order_audit                             │
                     │    - INSERT processed_events (consumer, eventId)     │
                     └─────────────────────────────────────────────────────┘
```

## The three concepts

| Concept | Where | What it guarantees |
| --- | --- | --- |
| **transaction** | [`orders.service.ts`](api/src/orders/orders.service.ts) | the `Order` row and its `order.created` event commit together or not at all |
| **outbox** | [`outbox.service.ts`](api/src/outbox/outbox.service.ts) + [`outbox-relay.service.ts`](api/src/outbox/outbox-relay.service.ts) | events survive a crash between "DB committed" and "message sent"; the relay drains them with `FOR UPDATE SKIP LOCKED` so it scales horizontally |
| **event + idempotency** | [`event-bus.ts`](api/src/events/event-bus.ts) (seam), [`pgboss-event-bus.ts`](api/src/events/pgboss-event-bus.ts), [`idempotency.service.ts`](api/src/consumers/idempotency.service.ts) | at-least-once delivery is made exactly-once per `(consumer, eventId)` via `processed_events` |

The `EventBus` interface is the transport seam: today `PgBossEventBus` (Postgres,
zero extra infra). Swap the binding in [`events.module.ts`](api/src/events/events.module.ts)
for a `BullMqEventBus` (Redis) later — nothing else changes.

The relay runs in one of two modes (`OUTBOX_RELAY_MODE`, default `manual`):
`poll` dispatches PENDING rows every `OUTBOX_POLL_INTERVAL_MS`; `manual` only
dispatches when `POST /outbox/drain` is called (the web **Refresh** button does
this). Manual mode avoids holding an idle connection cycle open against a
capped pooler — see [Database connections](#database-connections).

## Layout

```
api/   NestJS 10 + Prisma 6 + pg-boss 10   (Node 20)
web/   Next.js 15 (App Router)             — one button
```

## Run locally

```bash
# 0. prerequisites: Node 20+, pnpm 9, Docker

# 1. Postgres (and Redis, unused for now)
pnpm db:up

# 2. api
cd api
cp .env.example .env
pnpm install
pnpm prisma migrate deploy    # apply prisma/migrations
pnpm start:dev                # http://localhost:3001  (APP_ROLE=all → api + relay + consumer)

# 3. web  (new terminal)
cd web
cp .env.example .env
pnpm install
pnpm dev                      # http://localhost:3000
```

Open <http://localhost:3000>, click **Create order**. The row appears as
`PENDING`, then flips to `CONFIRMED` within a second or two once the relay
publishes and the consumer runs. Watch the stat tiles and the api logs.

Quick API poke:

```bash
curl -XPOST localhost:3001/orders -H 'content-type: application/json' \
  -d '{"customer":"cli","amountCents":4200}'
curl localhost:3001/debug/stats
curl localhost:3001/health
```

## Process roles

One container image, four modes via `APP_ROLE`:

| `APP_ROLE` | HTTP API | outbox relay | consumers |
| --- | --- | --- | --- |
| `all` (default) | ✅ | ✅ | ✅ |
| `web` | ✅ | — | — |
| `relay` | ✅ (health only) | ✅ | — |
| `consumer` | ✅ (health only) | — | ✅ |

Run everything in one service to keep it simple, or split into `web` + `relay` +
`consumer` services for independent scaling. Every mode still serves `/health`.

## Deploy to Railway

1. **Push this repo to GitHub.**
2. **New Project → Deploy from GitHub repo.**
3. Add a **Postgres** database (Railway plugin). It exposes `DATABASE_URL`.
4. **api service** — set *Root Directory* = `api` (Dockerfile is auto-detected):
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `DIRECT_URL` = `${{Postgres.DATABASE_URL}}` (Railway Postgres is a direct connection)
   - `APP_ROLE` = `all`  *(or create three services: `web`, `relay`, `consumer`)*
   - `NODE_ENV` = `production`
   - Healthcheck path `/health` is set in [`api/railway.json`](api/railway.json).
   - `prisma migrate deploy` runs automatically on boot (advisory-locked, safe from every replica).
5. **web service** — set *Root Directory* = `web` (or deploy `web/` to Vercel):
   - `NEXT_PUBLIC_API_URL` = the api service's **public** URL, e.g.
     `https://<api>.up.railway.app`. The browser calls the api directly, so this
     is baked into the client bundle at build time — a change needs a rebuild,
     and `.railway.internal` hostnames will not work from the browser.
   - Generate a public domain for this service.

> Splitting services: point all three api-side services at *Root Directory* `api`
> with the same Dockerfile, changing only `APP_ROLE`. Give each its own `/health`
> healthcheck.

### Supabase instead of Railway Postgres

- `DATABASE_URL` → Supavisor **session-mode** pooler (`...pooler.supabase.com:5432`)
- `DIRECT_URL` → direct connection (`db.<ref>.supabase.co:5432`) — used by migrations
- `PGBOSS_DATABASE_URL` → also the direct/session connection (pg-boss is **not**
  compatible with transaction-mode pooling)
- Run `pnpm prisma migrate deploy` from CI against `DIRECT_URL` (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

### Database connections

Each api container opens **several independent connection pools** against the same
Postgres:

| Consumer | Connection string | Pool size |
| --- | --- | --- |
| Prisma Client | `DATABASE_URL` | `num_cpus * 2 + 1` by default — on a shared host that can be 9–17 |
| pg-boss (send + work + maintenance) | `PGBOSS_DATABASE_URL` → `DIRECT_URL` → `DATABASE_URL` | `max: 2` (set in [`pgboss-event-bus.ts`](api/src/events/pgboss-event-bus.ts)) |
| boot migration | `DIRECT_URL` | short-lived |

Against a shared pooler — Supabase Supavisor **session mode** caps at ~15 clients
per project — the sum of these pools can exhaust the budget and publishes fail
with `EMAXCONNSESSION: max clients reached in session mode`. Mitigations, roughly
in order:

1. **Cap Prisma:** append `?connection_limit=5&pool_timeout=20` to `DATABASE_URL`
   (keep `pgbouncer=true` if it points at the `:6543` transaction pooler).
2. **Keep pg-boss small:** `max: 2` is already set; raise only with headroom to spare.
3. **Give pg-boss its own direct connection:** set `PGBOSS_DATABASE_URL` to the
   true direct endpoint (`db.<ref>.supabase.co:5432`) so it bypasses Supavisor's
   session budget entirely. That endpoint is IPv6-only — enable IPv6 egress on the
   Railway service or use Supabase's IPv4 add-on.
4. **Drop the idle relay churn:** `OUTBOX_RELAY_MODE=manual` (default) removes the
   always-on poll loop; the pipeline advances on `POST /outbox/drain`.
5. **Raise the ceiling:** Supabase → Project Settings → Database → Connection
   pooling → *Pool Size* (bounded by the instance's `max_connections`).

Railway's own Postgres plugin is a direct connection with no such session cap, so
none of this applies there — but the pools still exist, so keep an eye on
`max_connections` if you scale replicas.

Full checklist for starting a new project with this stack:
[`docs/database-connection-constraints.md`](docs/database-connection-constraints.md).

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml): install → `prisma generate`
→ `prisma migrate deploy` (against a throwaway Postgres) → build, for both `api`
and `web`.

## Not included (intentionally, but noted)

- **RLS / multi-tenant** — sketch in [`api/prisma/rls.example.sql`](api/prisma/rls.example.sql);
  needs a non-privileged DB role + `SET LOCAL app.current_tenant` in a per-request
  transaction via a Prisma client extension.
- **BullMQ / Redis** — phase 2; implement `BullMqEventBus` against the existing
  `EventBus` interface and flip the provider.
- **Sentry** — add `@sentry/nestjs` / `@sentry/nextjs` init at each entrypoint.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
