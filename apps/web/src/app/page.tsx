import { fetchHealth } from '@/lib/api-client';

export default async function HomePage() {
  // Runs on the server, where the browser URL would point at this container.
  // Falls back to the public URL when API_INTERNAL_URL is unset.
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