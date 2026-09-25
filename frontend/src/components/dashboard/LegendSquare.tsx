import React from 'react';

export interface LegendSquareProps {
  color: string;
  label?: string;
  className?: string;
}

export const LegendSquare: React.FC<LegendSquareProps> = ({
  color,
  label,
  className = '',
}) => {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="w-2.5 h-2.5 rounded-sm shrink-0 shadow-sm"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label && (
        <span className="text-xs text-[#9ca3af] font-medium truncate">
          {label}
        </span>
      )}
    </div>
  );
};
