import { NextResponse } from 'next/server';

const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = await fetch(`${API_URL}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customer: `web-user-${Math.random().toString(36).slice(2, 8)}`,
      amountCents: Math.floor(Math.random() * 9000) + 1000,
    }),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function GET() {
  const res = await fetch(`${API_URL}/orders`, { cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}
