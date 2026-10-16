import { Siren } from 'lucide-react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarList } from '@/components/dashboard/bar-list';
import { FailureTimeline } from '@/components/dashboard/failure-timeline';
import { KpiTile } from '@/components/dashboard/kpi-tile';
import { LabsDonut } from '@/components/dashboard/labs-donut';

describe('KpiTile', () => {
  it('shows the label, the figure, the caption and its tone', () => {
    const html = renderToStaticMarkup(
      <KpiTile label="Active incidents" value={7} caption="1 resolved" icon={Siren} tone="warning" />,
    );
    expect(html).toContain('Active incidents');
    expect(html).toContain('>7<');
    expect(html).toContain('1 resolved');
    expect(html).toContain('bg-warning-bg');
  });
});

describe('BarList', () => {
  it('scales bars to the largest count', () => {
    const html = renderToStaticMarkup(
      <BarList items={[['PROVISION_TIMEOUT', 12], ['PERMISSION_DENIED', 3]]} colourFor={() => 'red'} />,
    );
    expect(html).toContain('provision timeout');
    expect(html).toContain('width:100%');
    expect(html).toContain('width:25%');
  });
});

describe('LabsDonut', () => {
  // Negative: a state with no labs is left out rather than drawn as a sliver.
  it('totals the labs and lists only states that have any', () => {
    const html = renderToStaticMarkup(<LabsDonut counts={{ ready: 33, failed: 7, stopped: 0 }} />);
    expect(html).toContain('>40<');
    expect(html).toContain('ready');
    expect(html).not.toContain('stopped');
  });
});

describe('FailureTimeline', () => {
  it('lists only the categories that failed', () => {
    const zero = { PROVISION_TIMEOUT: 0, NETWORK_CONFIG: 0, QUOTA_EXCEEDED: 0 };
    const html = renderToStaticMarkup(
      <FailureTimeline
        series={{
          bucketMs: 60_000,
          buckets: [{ start: '2026-01-15T09:00:00.000Z', counts: { ...zero, PROVISION_TIMEOUT: 12, NETWORK_CONFIG: 1 } }],
          totals: { ...zero, PROVISION_TIMEOUT: 12, NETWORK_CONFIG: 1 },
        }}
      />,
    );
    expect(html).toContain('provision timeout');
    expect(html).toContain('network config');
    expect(html).not.toContain('quota exceeded');
  });
});

describe('FailureTimeline legend', () => {
  const series = {
    bucketMs: 60_000,
    buckets: [{ start: '2026-01-15T09:00:00.000Z', counts: { PROVISION_TIMEOUT: 12, NETWORK_CONFIG: 1 } }],
    totals: { PROVISION_TIMEOUT: 12, NETWORK_CONFIG: 1 },
  };

  function mount() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<FailureTimeline series={series} />));
    const button = (name: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name);
    return { button, unmount: () => act(() => root.unmount()) };
  }

  it('hides a category when clicked and shows it again on a second click', () => {
    const { button, unmount } = mount();
    expect(button('network config')?.getAttribute('aria-pressed')).toBe('true');
    act(() => button('network config')?.click());
    expect(button('network config')?.getAttribute('aria-pressed')).toBe('false');
    act(() => button('network config')?.click());
    expect(button('network config')?.getAttribute('aria-pressed')).toBe('true');
    unmount();
  });

  // Negative: an empty chart would read as "no failures", so the last one stays.
  it('never hides the last visible category', () => {
    const { button, unmount } = mount();
    act(() => button('network config')?.click());
    act(() => button('provision timeout')?.click());
    expect(button('provision timeout')?.getAttribute('aria-pressed')).toBe('true');
    unmount();
  });
});
