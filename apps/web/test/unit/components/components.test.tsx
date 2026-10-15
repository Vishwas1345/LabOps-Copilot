import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';

const refresh = vi.fn();
let pathname = '/';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => pathname,
}));

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
    const button = /<button class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(button).toContain('px-9');
    expect(button).not.toContain('px-3');
  });
});

describe('StatusBadge', () => {
  it('shows the status in words with its colour', () => {
    const html = renderToStaticMarkup(<StatusBadge status="manual_review" />);

    expect(html).toContain('manual review');
    expect(html).toContain('bg-danger-bg');
  });
});

describe('LiveRefresh', () => {
  // A stand-in EventSource the test can push messages through.
  class FakeEventSource {
    static opened: FakeEventSource[] = [];
    onmessage: ((message: { data: string }) => void) | null = null;
    listeners: Record<string, () => void> = {};
    closed = false;
    constructor(readonly url: string) {
      FakeEventSource.opened.push(this);
    }
    addEventListener(name: string, listener: () => void) {
      this.listeners[name] = listener;
    }
    close() {
      this.closed = true;
    }
  }

  const send = (source: FakeEventSource, incidentId: string | null) =>
    source.onmessage?.({ data: JSON.stringify({ action: 'recovery.verified', incidentId }) });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    refresh.mockClear();
    FakeEventSource.opened = [];
    pathname = '/';
  });

  // The fix: navigation must not open a new stream (each orphaned one held
  // an API stream for about a minute). The filter follows the URL instead.
  it('keeps one stream across navigation while the filter follows the page', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { LiveRefresh } = await import('@/components/live-refresh');
    const root = createRoot(document.createElement('div'));

    pathname = '/incidents/inc1';
    await act(async () => root.render(<LiveRefresh />));
    const [source] = FakeEventSource.opened;
    expect(source.url).toBe('/api/events/stream');
    await act(async () => {
      send(source, 'inc1');
      send(source, 'inc1');
      send(source, 'other');
      vi.advanceTimersByTime(400);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // Navigate to another incident, then to the overview.
    pathname = '/incidents/inc2';
    await act(async () => root.render(<LiveRefresh />));
    await act(async () => {
      send(source, 'inc1');
      vi.advanceTimersByTime(400);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      send(source, 'inc2');
      vi.advanceTimersByTime(400);
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    pathname = '/';
    await act(async () => root.render(<LiveRefresh />));
    await act(async () => {
      send(source, 'anything');
      vi.advanceTimersByTime(400);
    });
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(FakeEventSource.opened).toHaveLength(1);

    await act(async () => {
      source.listeners.reset();
      vi.advanceTimersByTime(400);
    });
    expect(refresh).toHaveBeenCalledTimes(4);

    await act(async () => root.unmount());
    expect(source.closed).toBe(true);
  });

  // Negative: work committed between the server render and the stream opening
  // must still reach the page, so the first ready triggers one read.
  it('reads the page once when the stream becomes ready', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { LiveRefresh } = await import('@/components/live-refresh');
    const root = createRoot(document.createElement('div'));

    await act(async () => root.render(<LiveRefresh />));
    const [source] = FakeEventSource.opened;
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      source.listeners.ready();
      vi.advanceTimersByTime(400);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
