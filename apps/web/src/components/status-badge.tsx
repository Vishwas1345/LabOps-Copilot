import { Badge } from '@/components/ui/badge';
import { humanise, statusVariant } from '@/lib/format';

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{humanise(status)}</Badge>;
}
