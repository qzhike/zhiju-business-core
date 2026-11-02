// Local read-only stepper using the workspace's shadcn/ui theme tokens.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

type StepperState = 'COMPLETE' | 'CURRENT' | 'UPCOMING' | 'ATTENTION';

interface StepperStep {
  id: string;
  title: string;
  state: StepperState;
  status: string;
  detail?: ReactNode;
}

interface StepperProps extends Omit<ComponentProps<'ol'>, 'children'> {
  steps: readonly StepperStep[];
  currentStepId?: string | undefined;
}

const indicatorClasses: Record<StepperState, string> = {
  COMPLETE: 'border-[var(--green)] bg-[var(--green)] text-white',
  CURRENT: 'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15',
  UPCOMING: 'border-border bg-background text-muted-foreground',
  ATTENTION: 'border-[var(--amber)] bg-[var(--amber)] text-white',
};

function Stepper({ steps, currentStepId, className, ...props }: StepperProps) {
  return (
    <ol
      data-slot="stepper"
      role="list"
      className={cn('m-0 grid auto-cols-fr grid-flow-col list-none p-0', className)}
      {...props}
    >
      {steps.map((step, index) => (
        <li
          key={step.id}
          data-slot="stepper-item"
          data-state={step.state}
          aria-current={step.id === currentStepId ? 'step' : undefined}
          className="relative min-w-0 text-center"
        >
          {index < steps.length - 1 && (
            <span
              data-slot="stepper-connector"
              aria-hidden="true"
              className={cn(
                'absolute top-4 left-1/2 h-0.5 w-full',
                step.state === 'COMPLETE' ? 'bg-[var(--green)]' : 'bg-border',
              )}
            />
          )}
          <span
            data-slot="stepper-indicator"
            aria-hidden="true"
            className={cn(
              'relative mx-auto flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold',
              indicatorClasses[step.state],
            )}
          >
            {step.state === 'COMPLETE' ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
                focusable="false"
              >
                <path d="m5 12 4 4L19 6" />
              </svg>
            ) : step.state === 'ATTENTION' ? (
              '!'
            ) : (
              index + 1
            )}
          </span>
          <div className="mt-3 space-y-1 px-1 [overflow-wrap:anywhere] sm:px-2">
            <strong
              data-slot="stepper-title"
              className="block text-xs leading-snug font-semibold text-foreground sm:text-sm"
            >
              {step.title}
            </strong>
            <span
              data-slot="stepper-status"
              className={cn(
                'block text-xs leading-snug text-muted-foreground',
                step.state === 'ATTENTION' && 'text-[var(--amber)]',
              )}
            >
              {step.status}
            </span>
            {step.detail && (
              <small className="block text-xs leading-snug text-muted-foreground">
                {step.detail}
              </small>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export { Stepper, type StepperStep };
