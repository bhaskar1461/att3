import React from 'react';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

export const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-[#1e1f24] group-[.toaster]:text-slate-100 group-[.toaster]:border-[#2a2b31] group-[.toaster]:shadow-xl',
          description: 'group-[.toast]:text-slate-400',
          actionButton:
            'group-[.toast]:bg-indigo-600 group-[.toast]:text-white',
          cancelButton:
            'group-[.toast]:bg-[#2a2b31] group-[.toast]:text-slate-400',
        },
      }}
      {...props}
    />
  );
};
