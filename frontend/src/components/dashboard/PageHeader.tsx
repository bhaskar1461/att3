import React from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  actions,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#2a2b31]/40 ${className}`}
    >
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
          {title}
        </h1>
        {description && (
          <p className="text-xs sm:text-sm text-[#9ca3af]">
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2.5 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
