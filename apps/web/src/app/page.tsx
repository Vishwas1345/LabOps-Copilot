import { fetchHealth } from '@/lib/api-client';

export default async function HomePage() {
  // This fetch runs on the Next.js server, not in the browser. Inside a
  // container, the browser-facing URL resolves to this container itself, so the
  // server needs its own address. Unprefixed variables are read at runtime and
  // never shipped to the browser; when unset, the public URL is used.
  const health = await fetchHealth(process.env.API_INTERNAL_URL);

  return (
    <main>
      <h1>LabOps Copilot</h1>
      <p>Next.js dashboard talking to a Node.js Fastify API.</p>
      <ul>
        <li>API: {health?.status ?? 'unreachable'}</li>
        <li>PostgreSQL: {health?.checks.database ?? 'unknown'}</li>
      </ul>
    </main>
  );
}