import * as React from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'neu-inset w-full rounded-xl border-0 px-3.5 text-[15px] text-ink placeholder:text-subtle outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger/60 disabled:opacity-60';

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn(fieldBase, 'h-11', className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        fieldBase,
        'h-11 appearance-none bg-size-[16px] bg-position-[right_0.85rem_center] bg-no-repeat pr-10',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7a85' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** Neumorphic checkbox: an inset well that fills with lagoon when checked. */
export function Checkbox({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'neu-inset mt-0.5 size-5 shrink-0 cursor-pointer appearance-none rounded-md transition',
        'checked:bg-primary checked:shadow-none checked:bg-size-[13px] checked:bg-center checked:bg-no-repeat',
        "checked:bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E\")]",
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-invalid:ring-2 aria-invalid:ring-danger/60',
        className,
      )}
      {...props}
    />
  );
}
