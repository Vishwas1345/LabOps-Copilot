const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Health = {
  service: string;
  status: string;
  checks: { database: string };
};

async function loadHealth(): Promise<Health | null> {
  try {
    const response = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Health;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await loadHealth();

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
