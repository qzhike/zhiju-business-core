// Adapted from shadcn/ui NativeSelect (MIT). The browser draws the arrow;
// keeping a single select preserves existing labels, refs and layout ownership.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'min-h-10 min-w-0 max-w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
