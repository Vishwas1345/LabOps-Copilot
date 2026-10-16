// The path from AI investigation to verified recovery, one step per stage,
// filled from the incident's own records. Live updates refresh the page, so a
// step lights up as the worker and the operator move it on.

import { Ban, Check, Circle, Loader2, Minus, X } from 'lucide-react';
import type { FlowStep, StepState } from '@/lib/investigation-flow';
import { cn } from '@/lib/utils';

const MARKER: Record<StepState, string> = {
  done: 'border-success bg-success text-card',
  active: 'border-info bg-info-bg text-info',
  blocked: 'border-danger bg-danger text-card',
  failed: 'border-danger bg-danger text-card',
  pending: 'border-border bg-card text-muted-foreground',
  skipped: 'border-dashed border-border bg-muted text-muted-foreground',
};

const ICON = { done: Check, active: Loader2, blocked: Ban, failed: X, pending: Circle, skipped: Minus } as const;

const STATE_LABEL: Record<StepState, string> = {
  done: 'done',
  active: 'in progress',
  blocked: 'blocked',
  failed: 'failed',
  pending: 'not started',
  skipped: 'skipped',
};

export function FlowStepper({ steps }: { steps: FlowStep[] }) {
  return (
    <ol aria-label="Investigation to recovery" className="grid gap-4 sm:grid-cols-5 sm:gap-2">
      {steps.map((step, index) => {
        const Icon = ICON[step.state];
        const next = steps[index + 1];
        return (
          <li
            key={step.key}
            className="animate-rise relative flex gap-3 sm:flex-col sm:gap-2"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            {next && (
              // The connector fills once this step is done, so progress reads left to right.
              <span aria-hidden className="absolute top-4 left-9 hidden h-px w-[calc(100%-2.25rem)] bg-border sm:block">
                {step.state === 'done' && <span className="animate-grow-x block h-full bg-success" />}
              </span>
            )}
            <span className="relative flex size-8 shrink-0 items-center justify-center">
              {step.state === 'active' && (
                <span aria-hidden className="animate-ping-soft absolute inset-0 rounded-full bg-info/30" />
              )}
              <span className={cn('relative flex size-8 items-center justify-center rounded-full border-2', MARKER[step.state])}>
                <Icon className={cn('size-4', step.state === 'active' && 'animate-spin')} strokeWidth={2.5} />
              </span>
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{step.label}</span>
              <span className="sr-only">: {STATE_LABEL[step.state]}. </span>
              <span className="block text-xs text-muted-foreground">{step.detail}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
