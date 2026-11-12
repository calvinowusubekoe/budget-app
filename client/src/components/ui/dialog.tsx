import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(20_33_42/0.28)] backdrop-blur-[3px] data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={cn(
          // Phones: a sheet from the bottom edge, full width, scrolling inside, clear of the home bar.
          'glass-strong fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl rounded-b-none p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] focus:outline-none',
          // Larger screens: centred card.
          'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-6',
          className,
        )}
        {...props}
      >
        <span aria-hidden className="mx-auto -mt-1 mb-3 block h-1 w-10 rounded-full bg-[var(--line)] sm:hidden" />
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 grid size-9 place-items-center rounded-lg text-muted hover:text-ink sm:top-4 sm:right-4 sm:size-8" aria-label="Close">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('pr-8 text-lg font-semibold', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('mt-1 text-sm text-muted', className)} {...props} />;
}
