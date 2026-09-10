import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export const dynamic = 'force-dynamic';

export async function GET() {
  const res = await fetch(`${API_URL}/debug/stats`, { cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}
