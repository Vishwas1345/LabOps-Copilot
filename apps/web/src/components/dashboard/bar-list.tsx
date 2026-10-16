import { humanise } from '@/lib/format';

/** Horizontal bars in plain CSS: no chart library needed for a ranked list. */
export function BarList({ items, colourFor }: { items: [string, number][]; colourFor: (key: string) => string }) {
  const max = Math.max(1, ...items.map(([, count]) => count));
  return (
    <ul className="space-y-2.5">
      {items.map(([key, count]) => (
        <li key={key} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>{humanise(key)}</span>
            <span className="font-medium tabular-nums">{count}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="animate-grow-x h-2 rounded-full"
              style={{ width: `${(count / max) * 100}%`, background: colourFor(key) }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
