import { Badge } from '@/components/ui/badge';
import { humanise, statusVariant } from '@/lib/format';

// A dot as well as the colour, so status never rests on colour alone.
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusVariant(status)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {humanise(status)}
    </Badge>
  );
}
