import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `output: 'standalone'` is for the Railway/Docker build only (the Dockerfile
// runs `node server.js` from .next/standalone). On Vercel it breaks the
// serverless function trace with pnpm's nested node_modules/.pnpm layout —
// Next's lazy `require('next/dist/compiled/source-map')` is not bundled and
// the function crashes at runtime. Vercel handles output + tracing itself.
const onVercel = !!process.env.VERCEL;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(onVercel
    ? {}
    : {
        output: 'standalone',
        // Trace from this folder (not the pnpm workspace root) so the standalone
        // output is always .next/standalone/server.js — matches the Dockerfile.
        outputFileTracingRoot: __dirname,
      }),
};

export default nextConfig;
