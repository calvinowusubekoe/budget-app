import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none transition-[box-shadow,background-color,color,transform] duration-150 disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Solid lagoon: the one action that matters on a screen.
        primary:
          'bg-primary text-primary-fg hover:bg-primary-hover shadow-[0_8px_18px_-10px_var(--primary),inset_0_1px_0_rgb(255_255_255/0.18)] active:translate-y-px',
        // Neumorphic: secondary actions pressed out of the surface.
        neu: 'neu-raised-sm text-ink hover:text-primary active:neu-pressed',
        ghost: 'text-muted hover:text-ink hover:bg-[var(--line)]',
        danger: 'bg-danger text-white hover:brightness-95 active:translate-y-px',
        link: 'text-primary underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        sm: 'h-8 rounded-lg px-3 text-sm',
        md: 'h-10 rounded-xl px-4 text-sm',
        lg: 'h-12 rounded-2xl px-6 text-base',
        icon: 'size-10 rounded-xl',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({ className, variant, size, asChild, loading, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
}

export { buttonVariants };
