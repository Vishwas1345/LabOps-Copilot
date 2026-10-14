import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchHealth } from '@/lib/api-client';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Server-side, through API_INTERNAL_URL: also proves the web container
  // reaches the API (the compose smoke test reads this line).
  const health = await fetchHealth(process.env.API_INTERNAL_URL);
  return (
    <main className="mx-auto mt-16 max-w-sm px-4">
      <Card>
        <CardHeader>
          <CardTitle>LabOps Copilot</CardTitle>
          <CardDescription>Sign in as an operator.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
          <p className="mt-6 text-xs text-muted-foreground">
            API: {health?.status ?? 'unreachable'} · PostgreSQL: {health?.checks.database ?? 'unknown'}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
