import * as React from 'react';
import { cn } from '../../lib/utils';

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback: string;
}

export const Avatar: React.FC<AvatarProps> = ({ src, alt, fallback, className, ...props }) => {
  const [hasError, setHasError] = React.useState(false);

  return (
    <div
      className={cn(
        'relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[#2a2b31] bg-gradient-to-tr from-[#6366f1] to-[#8b5cf6] text-white',
        className
      )}
      {...props}
    >
      {src && !hasError ? (
        <img
          src={src}
          alt={alt || fallback}
          onError={() => setHasError(true)}
          className="aspect-square h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-bold text-xs">
          {fallback}
        </div>
      )}
    </div>
  );
};
