import { fetchHealth } from '@/lib/api-client';

export default async function HomePage() {
  const health = await fetchHealth();

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