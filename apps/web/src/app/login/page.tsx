import { Activity } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchHealth } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Server-side, through API_INTERNAL_URL: also proves the web container
  // reaches the API (the compose smoke test reads this line).
  const health = await fetchHealth(process.env.API_INTERNAL_URL);
  const up = health?.status === 'ok';
  return (
    <main className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">LabOps Copilot</h1>
            <p className="text-sm text-muted-foreground">Incident correlation and safe recovery for cloud lab operations</p>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Operators only. Every sign-in is recorded in the audit trail.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn('size-2 rounded-full', up ? 'bg-success' : 'bg-danger')} />
          API: {health?.status ?? 'unreachable'} · PostgreSQL: {health?.checks.database ?? 'unknown'}
        </p>
      </div>
    </main>
  );
}
