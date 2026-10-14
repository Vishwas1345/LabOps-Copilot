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

describe('AutoRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
    refresh.mockClear();
  });

  it('refreshes while active and stops when inactive', async () => {
    vi.useFakeTimers();
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { AutoRefresh } = await import('./auto-refresh');
    const root = createRoot(document.createElement('div'));

    await act(async () => root.render(<AutoRefresh active />));
    await act(async () => vi.advanceTimersByTime(4_100));
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => root.render(<AutoRefresh active={false} />));
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(2);
    root.unmount();
  });
});
