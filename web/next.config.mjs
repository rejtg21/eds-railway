import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Trace from this folder (not the pnpm workspace root) so the standalone
  // output is always .next/standalone/server.js — matches the Dockerfile.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
