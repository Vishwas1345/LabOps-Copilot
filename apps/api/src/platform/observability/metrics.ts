// Shapes shared by the metrics each module derives from its own committed rows
// (ARCHITECTURE.md section 12). Every duration is in milliseconds.

export interface DurationSummary {
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

/** What a `percentile_cont` query returns for one duration. */
export interface PercentileRow {
  samples: number;
  p50: number | null;
  p95: number | null;
}

const round = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(Number(value));

// Null, not 0, when nothing was measured: "no data" must never read as "instant".
export function toDurationSummary(row: PercentileRow | undefined): DurationSummary {
  return { samples: row?.samples ?? 0, p50Ms: round(row?.p50), p95Ms: round(row?.p95) };
}

/** Zero for every known key, so an absent status reads 0 rather than missing. */
export function countsFor<K extends string>(
  keys: readonly K[],
  rows: { key: K; count: number }[],
): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const row of rows) counts[row.key] = row.count;
  return counts;
}
