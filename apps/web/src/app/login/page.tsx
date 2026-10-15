import { Activity } from 'lucide-react';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiUrl } from '@/lib/api';
import { fetchHealth } from '@/lib/api-client';
import { googleErrorMessage } from '@/lib/google-flow';
import { cn } from '@/lib/utils';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

const providersSchema = z.object({ data: z.object({ google: z.boolean() }) });

// Offered only when the API says Google is configured; any failure hides it.
async function googleEnabled(): Promise<boolean> {
  const response = await fetch(apiUrl('/api/auth/providers'), { cache: 'no-store' }).catch(() => null);
  const parsed = response?.ok ? providersSchema.safeParse(await response.json()) : null;
  return parsed?.success === true && parsed.data.data.google;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Server-side, through API_INTERNAL_URL: also proves the web container
  // reaches the API (the compose smoke test reads this line).
  const [health, google, { error }] = await Promise.all([
    fetchHealth(process.env.API_INTERNAL_URL),
    googleEnabled(),
    searchParams,
  ]);
  const up = health?.status === 'ok';
  const googleError = googleErrorMessage(error);
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
          <CardContent className="space-y-4">
            {googleError && <Alert variant="destructive">{googleError}</Alert>}
            <LoginForm />
            {google && (
              <>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
                {/* A plain link: the start route redirects the whole page to Google. */}
                <Button asChild variant="outline" className="w-full">
                  <a href="/auth/google/start">Sign in with Google</a>
                </Button>
              </>
            )}
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
