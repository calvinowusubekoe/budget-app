import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-sm font-medium text-ink', className)} {...props} />;
}

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactElement<{ 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
  className?: string;
}

/** Label + control + message, wired for screen readers. */
export function Field({ label, htmlFor, error, hint, children, className }: FieldProps) {
  const msgId = `${htmlFor}-msg`;
  const control = React.cloneElement(children, {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || hint ? msgId : undefined,
  });
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {control}
      {error ? (
        <p id={msgId} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-[13px] text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
