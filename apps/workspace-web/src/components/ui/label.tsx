// Adapted from shadcn/ui (MIT). Preserve native wrapping-label semantics.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label data-slot="label" className={cn('block text-sm font-medium', className)} {...props} />
  );
}
