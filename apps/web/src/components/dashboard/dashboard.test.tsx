import { Siren } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarList } from './bar-list';
import { FailureTimeline } from './failure-timeline';
import { KpiTile } from './kpi-tile';
import { LabsDonut } from './labs-donut';

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
