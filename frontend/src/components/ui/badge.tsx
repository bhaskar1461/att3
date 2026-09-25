import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border border-[#2a2b31] bg-[#2a2b31]/60 text-slate-200 hover:bg-[#2a2b31]',
        secondary:
          'border border-transparent bg-slate-800 text-slate-300 hover:bg-slate-700',
        outline: 'border border-[#2a2b31] text-slate-300',
        success:
          'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 font-bold',
        destructive:
          'border border-red-500/20 bg-red-500/10 text-red-400 font-bold',
        deltaPositive:
          'border border-[#10b981]/30 bg-[#10b981]/15 text-[#10b981] font-bold text-[11px] px-2 py-0.5',
        deltaNegative:
          'border border-[#ef4444]/30 bg-[#ef4444]/15 text-[#ef4444] font-bold text-[11px] px-2 py-0.5',
        accent:
          'border border-[#6366f1]/30 bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/20 text-indigo-300 font-semibold',
        hero:
          'border border-purple-400/30 bg-purple-500/20 text-purple-200 font-bold',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
