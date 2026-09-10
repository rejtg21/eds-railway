'use client';

import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { useCallback, useEffect, useState } from 'react';

// The browser talks to the NestJS API on Railway directly. Set
// NEXT_PUBLIC_API_URL in the Vercel project (it is inlined at build time).
const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
).replace(/\/+$/, '');

interface Order {
  id: string;
  customer: string;
  amountCents: number;
  status: 'PENDING' | 'CONFIRMED';
  createdAt: string;
}

interface Stats {
  orders: number;
  outbox: { pending: number; published: number; dead: number };
  processedEvents: number;
  audits: number;
}

export default function Page() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const say = (line: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 12));

  const refresh = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([
        fetch(`${API_URL}/orders`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`${API_URL}/debug/stats`, { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (Array.isArray(o)) setOrders(o);
      if (s && s.outbox) setStats(s);
    } catch {
      /* ignore transient errors while polling */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

  const createOrder = async () => {
    setBusy(true);
    say('POST /orders  -> API opens a transaction');
    try {
      const res = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer: `web-user-${Math.random().toString(36).slice(2, 8)}`,
          amountCents: Math.floor(Math.random() * 9000) + 1000,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        say(
          `order ${String(data.order?.id).slice(0, 8)} committed with outbox event ${String(
            data.eventId,
          ).slice(0, 8)} (status PENDING)`,
        );
        say('relay will publish -> consumer confirms it shortly...');
      } else {
        say(`error: ${JSON.stringify(data)}`);
      }
      await refresh();
    } catch (e) {
      say(`request failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="wrap">
      <header className="topbar">
        <span className="brand">Event-Driven Demo</span>
        <div className="auth">
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="secondary">Sign in</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="primary sm">Sign up</button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </header>

      <h1>Event-Driven Demo</h1>
      <p className="sub">
        Button → NestJS API → <code>Order</code> + <code>outbox_events</code> in one
        transaction → relay (<code>FOR UPDATE SKIP LOCKED</code>) → pg-boss → idempotent
        consumer marks the order <code>CONFIRMED</code>.
      </p>

      <button className="primary" onClick={createOrder} disabled={busy}>
        {busy ? 'Creating…' : 'Create order (publish event)'}
      </button>

      {stats && (
        <div className="stats">
          <div className="stat">
            <div className="k">Orders</div>
            <div className="v">{stats.orders}</div>
          </div>
          <div className="stat">
            <div className="k">Outbox pending</div>
            <div className="v">{stats.outbox.pending}</div>
          </div>
          <div className="stat">
            <div className="k">Outbox published</div>
            <div className="v">{stats.outbox.published}</div>
          </div>
          <div className="stat">
            <div className="k">Processed events</div>
            <div className="v">{stats.processedEvents}</div>
          </div>
          <div className="stat">
            <div className="k">Audit rows</div>
            <div className="v">{stats.audits}</div>
          </div>
          {stats.outbox.dead > 0 && (
            <div className="stat">
              <div className="k">Outbox DEAD</div>
              <div className="v">{stats.outbox.dead}</div>
            </div>
          )}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: 'var(--muted)' }}>
                No orders yet — click the button.
              </td>
            </tr>
          )}
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <code>{o.id.slice(0, 8)}</code>
              </td>
              <td>{o.customer}</td>
              <td>${(o.amountCents / 100).toFixed(2)}</td>
              <td>
                <span className={`badge ${o.status}`}>{o.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="log">{log.join('\n')}</div>
    </main>
  );
}
