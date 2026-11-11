import { cn } from '@/lib/utils';

/** Inset neumorphic track with a raised thumb on the selected option. */
export function Segmented<T extends string>({ label, value, options, onChange, size = 'md' }: { label: string; value: T; options: { value: T; text: string; disabled?: boolean }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="neu-inset inline-flex rounded-2xl p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn('rounded-xl font-medium transition disabled:opacity-45', size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm', value === o.value ? 'neu-raised-sm text-ink' : 'text-muted hover:text-ink')}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}
