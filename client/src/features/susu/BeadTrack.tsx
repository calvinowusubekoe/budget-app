import { cn } from '@/lib/utils';
import { formatMoney, formatYmd } from '@/lib/money';
import type { SusuWindow } from '@/types/api';

/*
 * Borders, not rings: Tailwind rings are box-shadows and would be overwritten
 * by the neumorphic shadow; neu-* also resets the background shorthand, so the
 * half-fill gradient is set as background-image after it.
 */
const BEAD: Record<SusuWindow['status'], string> = {
  met: 'bg-gold shadow-[inset_-2px_-2px_4px_rgb(0_0_0/0.18),inset_2px_2px_4px_rgb(255_255_255/0.35)]',
  partial: 'border-2 border-gold/80 [background:linear-gradient(to_top,var(--gold)_50%,var(--surface)_50%)]',
  missed: 'neu-inset border-2 border-danger/70',
  open: 'neu-raised-sm border-2 border-gold',
  paused: 'border border-dashed border-subtle/80',
};

const LABEL: Record<SusuWindow['status'], string> = {
  met: 'Paid in full',
  partial: 'Part paid',
  missed: 'Missed',
  open: 'Due now',
  paused: 'Paused',
};

/**
 * One bead per contribution period, oldest on the left, like the counting
 * beads and stamp cards Susu collectors keep. Gold = met, half-filled =
 * partial, hollow with a clay ring = missed, outlined = open, dashed = paused.
 */
export function BeadTrack({ windows, currency, className }: { windows: SusuWindow[]; currency: string; className?: string }) {
  const ordered = [...windows].sort((a, b) => a.index - b.index);
  return (
    <div className={cn('grid gap-3', className)}>
      <ol className="flex flex-wrap gap-1.5" aria-label="Contribution periods, oldest first">
        {ordered.map((w) => {
          const title = `${formatYmd(w.due)}: ${LABEL[w.status]}, ${formatMoney(w.contributed, currency)} of ${formatMoney(w.expected, currency)}`;
          return (
            <li key={w.index} title={title} aria-label={title} className="relative">
              <span className={cn('block size-5 rounded-full transition', BEAD[w.status])} />
            </li>
          );
        })}
      </ol>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
        {(['met', 'partial', 'missed', 'open', 'paused'] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn('inline-block size-3 rounded-full', BEAD[s])} />
            {LABEL[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}
