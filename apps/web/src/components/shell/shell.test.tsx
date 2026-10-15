import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_COOKIE } from '@/lib/theme';
import { Breadcrumbs } from './breadcrumbs';
import { SIDEBAR_COOKIE, Sidebar } from './sidebar';
import { ThemeToggle } from './theme-toggle';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

function mount(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  pathname = '/';
  document.documentElement.className = '';
  document.cookie = `${THEME_COOKIE}=; max-age=0; path=/`;
  document.cookie = `${SIDEBAR_COOKIE}=; max-age=0; path=/`;
  document.body.innerHTML = '';
});

describe('Breadcrumbs', () => {
  it('shows the section and the open record', () => {
    pathname = '/incidents/abc123';
    const html = renderToStaticMarkup(<Breadcrumbs />);
    expect(html).toContain('Overview');
    expect(html).toContain('href="/incidents"');
    expect(html).toContain('abc123');
  });

  // Negative: an unknown path segment is not echoed as a section name.
  it('ignores a section it does not know', () => {
    pathname = '/nowhere';
    expect(renderToStaticMarkup(<Breadcrumbs />)).not.toContain('nowhere');
  });
});

describe('Sidebar', () => {
  it('marks the current page and remembers being collapsed', () => {
    pathname = '/incidents/abc123';
    const { container, unmount } = mount(<Sidebar initialCollapsed={false} footer={null} />);
    expect(container.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/incidents');

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')?.click());
    expect(container.querySelector('aside')?.dataset.collapsed).toBe('true');
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`);
    unmount();
  });
});

describe('ThemeToggle', () => {
  it('pins the opposite theme on <html> and in the cookie the server reads', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { container, unmount } = mount(<ThemeToggle />);
    const button = container.querySelector('button');

    act(() => button?.click());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);

    act(() => button?.click());
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`);
    unmount();
    vi.unstubAllGlobals();
  });
});
