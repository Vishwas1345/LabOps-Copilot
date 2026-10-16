import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountUp } from '@/components/dashboard/count-up';
import { ConfidenceGauge } from '@/components/incident/confidence-gauge';
import { ExpiryCountdown } from '@/components/incident/expiry-countdown';
import { FlowStepper } from '@/components/incident/flow-stepper';
import { flowSteps } from '@/lib/investigation-flow';

function mount(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => vi.useRealTimers());

describe('ConfidenceGauge', () => {
  it("shows the figure and says it is the model's own estimate", () => {
    const html = renderToStaticMarkup(<ConfidenceGauge confidence={0.72} />);
    expect(html).toContain('72%');
    expect(html).toContain("Confidence: 72% (model&#x27;s own estimate)");
  });

  // Negative: no confidence must never draw a filled ring or a number.
  it('draws no ring and no number without a confidence', () => {
    const html = renderToStaticMarkup(<ConfidenceGauge confidence={null} />);
    expect(html).toContain('—');
    expect(html).not.toContain('animate-gauge');
  });
});

describe('FlowStepper', () => {
  it('names every step and its state for screen readers', () => {
    const html = renderToStaticMarkup(<FlowStepper steps={flowSteps(undefined, undefined)} />);
    for (const label of ['AI analysis', 'Output checked', 'Policy check', 'Human approval', 'Verified']) {
      expect(html).toContain(label);
    }
    expect(html).toContain(': not started. ');
  });
});

describe('ExpiryCountdown', () => {
  it('counts down to the expiry once mounted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
    const { container, unmount } = mount(<ExpiryCountdown expiresAt="2026-10-16T10:02:05.000Z" />);
    expect(container.textContent).toContain('2:05 left');
    act(() => vi.advanceTimersByTime(5000));
    expect(container.textContent).toContain('2:00 left');
    unmount();
  });

  it('says expired once the time has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:05:00.000Z'));
    const { container, unmount } = mount(<ExpiryCountdown expiresAt="2026-10-16T10:00:00.000Z" />);
    expect(container.textContent).toContain('expired');
    unmount();
  });

  it('renders nothing without an expiry', () => {
    expect(renderToStaticMarkup(<ExpiryCountdown expiresAt={null} />)).toBe('');
  });
});

describe('CountUp', () => {
  // The server and a no-JavaScript reader see the real number, never zero.
  it('renders the final value before any animation', () => {
    expect(renderToStaticMarkup(<CountUp value={19} />)).toContain('>19<');
  });
});
