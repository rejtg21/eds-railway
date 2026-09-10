# Constraint: database connection budget

Applies to any project with this shape:

- **NestJS + Prisma** for the app
- **pg-boss** (Postgres-backed queue) for events / jobs
- **transactional outbox + relay** draining `PENDING` rows
- Postgres behind a **connection pooler** (Supabase Supavisor, PgBouncer, RDS Proxy, Neon)
- deployed as containers (Railway, Fly, ECS) and/or a separate frontend (Vercel)

## The constraint

**The scarce resource is _open connections held at rest_, not requests/sec.**
A single idle container in this setup holds ~15–25 Postgres connections before it
serves a single request. Managed poolers cap concurrent clients low — Supabase's
**session-mode pooler is ~15 per project on the free/small tiers** — so you can
exhaust the budget with zero traffic and see:

```
EMAXCONNSESSION: max clients reached in session mode - max clients are limited to pool_size: 15
```

### Where the connections go (per container)

| Client | Default pool | Notes |
| --- | --- | --- |
| Prisma Client | `num_cpus * 2 + 1` | On shared hosts `os.cpus()` reports the **host** core count → often 9–17. Tuned for a dedicated DB, not a small pooler. |
| pg-boss | ~10 (`max`), plus periodic maintenance/monitor queries | Long-lived worker; needs a **session** connection (LISTEN/NOTIFY, advisory locks) — cannot use a transaction-mode pooler. |
| Outbox relay poll loop | 1 transaction every poll interval | Always-on if the relay polls on a timer. |
| Boot migration | 1, short-lived | `prisma migrate deploy` at startup. |

`replicas × (prisma_pool + pgboss_pool) + overhead` must stay **under the pooler's
client cap _and_ the database's `max_connections`**. With defaults, one replica
already blows a 15-client cap.

## Decisions to make when starting

1. **Size Prisma's pool explicitly. Never ship the default.**
   `DATABASE_URL=...?connection_limit=5&pool_timeout=20`
   Point Prisma at the **transaction-mode** pooler (Supabase `:6543`, add
   `pgbouncer=true`); it multiplexes many clients onto few real connections.

2. **Give pg-boss its own small, direct connection.**
   Set a dedicated `PGBOSS_DATABASE_URL` to the **direct** endpoint
   (`db.<ref>.supabase.co:5432`), bypassing the pooler's session budget, and cap it
   (`max: 2`). The direct endpoint may be IPv6-only — enable IPv6 egress on the
   host or use an IPv4 add-on.
   pg-boss must **not** use a transaction-mode pooler.

3. **Keep `DIRECT_URL` for migrations only.** Short-lived; fine to share the
   session pooler.

4. **Decide relay cadence.** A timer poll loop holds a connection cycle open
   forever. Prefer an on-demand trigger (`POST /outbox/drain`, a cron job, or
   `LISTEN/NOTIFY`) unless sustained throughput justifies constant polling.

5. **Do the arithmetic before choosing replica counts.**
   `max_replicas ≈ (pooler_client_cap − headroom) / (prisma_limit + pgboss_max)`.
   If that number is < 2, the tier is too small to scale — plan the upgrade now.

6. **Split roles (`web` / `relay` / `consumer`) only after step 5.** More services
   = more pools. Each still needs its budget counted.

## Scaling ceiling of this design

- **Scales horizontally:** relay uses `FOR UPDATE SKIP LOCKED`; consumers are
  idempotent per `(consumer, eventId)`. Run N replicas of each safely.
- **First bottleneck:** the **connection budget** — a config/tier problem, fixed
  by the steps above.
- **Second bottleneck (few hundred events/sec):** pg-boss-on-Postgres itself —
  queue-table contention, polling overhead, bloat. Keep the transport behind an
  interface (`EventBus`) so it can swap to Redis/BullMQ or SQS with no business-logic
  change.
- **Free tier is a hobby ceiling.** ~15 pooled connections. Paid Postgres gives
  hundreds to thousands; move before you need to.

## Quick check before deploying

- [ ] `DATABASE_URL` has an explicit `connection_limit`
- [ ] Prisma uses the transaction pooler; pg-boss uses a direct/session connection
- [ ] `PGBOSS_DATABASE_URL` set and its pool `max` is small (≤ 3)
- [ ] Relay cadence chosen deliberately (manual/cron vs. timer)
- [ ] `replicas × (prisma_limit + pgboss_max) + overhead` < pooler cap and `max_connections`
- [ ] Know the pooler's client cap and the DB's `max_connections` for the chosen tier
