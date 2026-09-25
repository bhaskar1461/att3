import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-sm hover:from-[#5558e6] hover:to-[#7c4deb]',
        secondary:
          'bg-[#2a2b31] text-slate-200 hover:bg-[#34353d] hover:text-white',
        outline:
          'border border-[#2a2b31] bg-transparent text-slate-300 hover:bg-[#2a2b31] hover:text-white',
        ghost:
          'text-slate-400 hover:bg-[#2a2b31]/60 hover:text-slate-100',
        hero:
          'bg-gradient-to-r from-[#7c3aed] to-[#a78bfa] text-white font-bold shadow-md shadow-purple-500/20 hover:opacity-95',
        destructive:
          'bg-rose-600 text-white hover:bg-rose-500',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-[11px]',
        lg: 'h-10 rounded-md px-6 text-sm',
        icon: 'h-9 w-9 p-0',
        iconSm: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
