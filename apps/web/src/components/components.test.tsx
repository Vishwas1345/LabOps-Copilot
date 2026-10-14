import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { StatusBadge } from './status-badge';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

describe('ui primitives', () => {
  it('render with merged classes', () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>
          <CardTitle>t</CardTitle>
          <CardDescription>d</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">a</Alert>
          <Button size="sm" className="px-9">
            b
          </Button>
          <Badge variant="warning">w</Badge>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>h</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>c</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>,
    );

    expect(html).toContain('role="alert"');
    // tailwind-merge: the caller's px-9 replaces the size's px-3.
    expect(html).toContain('px-9');
    expect(html).not.toContain('px-3');
  });
});

describe('StatusBadge', () => {
  it('shows the status in words with its colour', () => {
    const html = renderToStaticMarkup(<StatusBadge status="manual_review" />);

    expect(html).toContain('manual review');
    expect(html).toContain('bg-destructive');
  });
});

describe('LiveRefresh', () => {
  // A stand-in EventSource the test can push messages through.
  class FakeEventSource {
    static last: FakeEventSource | undefined;
    onmessage: ((message: { data: string }) => void) | null = null;
    listeners: Record<string, () => void> = {};
    closed = false;
    constructor(readonly url: string) {
      FakeEventSource.last = this;
    }
    addEventListener(name: string, listener: () => void) {
      this.listeners[name] = listener;
    }
    close() {
      this.closed = true;
    }
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    refresh.mockClear();
  });

  it('refreshes once per burst of relevant events, ignores others, closes on unmount', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { LiveRefresh } = await import('./live-refresh');
    const root = createRoot(document.createElement('div'));

    await act(async () => root.render(<LiveRefresh incidentId="inc1" />));
    const source = FakeEventSource.last!;
    expect(source.url).toBe('/api/events/stream');

    const send = (incidentId: string | null) =>
      source.onmessage?.({ data: JSON.stringify({ action: 'recovery.verified', incidentId }) });
    await act(async () => {
      send('inc1');
      send('inc1');
      send('other');
      vi.advanceTimersByTime(400);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      source.listeners.reset();
      vi.advanceTimersByTime(400);
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    expect(source.closed).toBe(true);
  });
});
