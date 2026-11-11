import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemePref } from '@/hooks/useTheme';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 font-semibold tracking-tight text-ink', className)}>
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="18" fill="var(--primary)" />
        <path d="M17 41c6-15 12-15 15-8s9 6 15-9" fill="none" stroke="#E3C27A" strokeWidth="5.5" strokeLinecap="round" />
        <circle cx="17" cy="45" r="3.2" fill="#E3E8ED" />
      </svg>
      <span className="text-[17px]">BudgetFlow</span>
    </span>
  );
}

/**
 * Two soft light sources behind the glass, lagoon and gold. Static on
 * purpose: they give glass something to refract without competing for
 * attention.
 */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 -left-32 size-[34rem] rounded-full blur-[110px]" style={{ background: 'var(--orb-a)' }} />
      <div className="absolute -right-40 -bottom-48 size-[38rem] rounded-full blur-[120px]" style={{ background: 'var(--orb-b)' }} />
      <div className="absolute top-1/3 left-1/2 size-[22rem] -translate-x-1/2 rounded-full blur-[120px] opacity-60" style={{ background: 'var(--orb-a)' }} />
    </div>
  );
}

const options: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'Match device', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/** Segmented neumorphic control: the selected segment is pressed in. */
export function ThemeToggle({ className }: { className?: string }) {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('neu-raised-sm inline-flex gap-1 rounded-xl p-1', className)}>
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          title={label}
          onClick={() => setPref(value)}
          className={cn(
            'grid size-8 place-items-center rounded-lg text-subtle transition',
            pref === value ? 'neu-pressed text-primary' : 'hover:text-ink',
          )}
        >
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
