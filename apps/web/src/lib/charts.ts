// Chart styling shared by every chart, so a category keeps one colour
// everywhere. Values are CSS variables, so both themes follow automatically.

export const CATEGORY_COLOURS: Record<string, string> = {
  PROVISION_TIMEOUT: 'var(--chart-1)',
  NETWORK_CONFIG: 'var(--chart-2)',
  PERMISSION_DENIED: 'var(--chart-3)',
  DEPENDENCY_UNAVAILABLE: 'var(--chart-4)',
  QUOTA_EXCEEDED: 'var(--chart-5)',
  VALIDATION_FAILED: 'var(--chart-6)',
};

export const colourFor = (category: string): string => CATEGORY_COLOURS[category] ?? 'var(--chart-6)';

/** Bucket start as a short time label: "14:05", or a date for day buckets. */
export function bucketLabel(iso: string, bucketMs: number): string {
  const date = new Date(iso);
  return bucketMs >= 24 * 3_600_000 ? iso.slice(0, 10) : date.toISOString().slice(11, 16);
}

/** Non-zero entries, largest first: what a bar list shows. */
export function ranked(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
