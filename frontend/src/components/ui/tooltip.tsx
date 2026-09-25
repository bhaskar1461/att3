import * as React from 'react';
import { cn } from '../../lib/utils';

interface TooltipContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  position?: 'right' | 'top' | 'bottom' | 'left';
}

const TooltipContext = React.createContext<TooltipContextType | null>(null);

export const TooltipProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};

export interface TooltipProps {
  children: React.ReactNode;
  delayDuration?: number;
  position?: 'right' | 'top' | 'bottom' | 'left';
}

export const Tooltip: React.FC<TooltipProps> = ({ children, position = 'right' }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  return (
    <TooltipContext.Provider value={{ isOpen, setIsOpen, position }}>
      <div className="relative inline-flex items-center justify-center group/tooltip">
        {children}
      </div>
    </TooltipContext.Provider>
  );
};

export const TooltipTrigger = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & { asChild?: boolean }
>(({ children, className, ...props }, ref) => {
  const ctx = React.useContext(TooltipContext);
  return (
    <div
      ref={ref as any}
      onMouseEnter={() => ctx?.setIsOpen(true)}
      onMouseLeave={() => ctx?.setIsOpen(false)}
      onFocus={() => ctx?.setIsOpen(true)}
      onBlur={() => ctx?.setIsOpen(false)}
      className={cn('inline-flex items-center justify-center', className)}
      {...props}
    >
      {children}
    </div>
  );
});
TooltipTrigger.displayName = 'TooltipTrigger';

export const TooltipContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { side?: 'right' | 'top' | 'bottom' | 'left' }
>(({ children, className, side = 'right', ...props }, ref) => {
  const ctx = React.useContext(TooltipContext);
  const effectiveSide = side || ctx?.position || 'right';

  const positionClasses = {
    right: 'left-full ml-2.5 top-1/2 -translate-y-1/2',
    left: 'right-full mr-2.5 top-1/2 -translate-y-1/2',
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
  }[effectiveSide];

  return (
    <div
      ref={ref}
      role="tooltip"
      className={cn(
        'absolute z-50 pointer-events-none whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium tracking-wide shadow-xl',
        'bg-[#1e1f24] text-slate-100 border border-[#2a2b31]',
        'dark:bg-[#1e1f24] dark:text-slate-100 dark:border-[#2a2b31]',
        'transition-all duration-150',
        ctx?.isOpen
          ? 'opacity-100 scale-100 visible'
          : 'opacity-0 scale-95 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100 group-hover/tooltip:visible',
        positionClasses,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
TooltipContent.displayName = 'TooltipContent';
