import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, AlertTriangle, Inbox } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { ApiError } from '../api/client';

export interface WidgetQueryLike<TData = any> {
  data?: TData;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  refetch: () => Promise<unknown> | void;
  isFetching?: boolean;
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  cta?: {
    label: string;
    to?: string;
    onClick?: () => void;
  };
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  cta,
  className = '',
}) => {
  return (
    <Card
      className={`p-5 rounded-[12px] bg-[#1e1f24] border border-[#2a2b31] flex flex-col items-center justify-center text-center min-h-[140px] ${className}`}
    >
      <div className="w-9 h-9 rounded-full bg-[#2a2b31]/50 flex items-center justify-center text-[#9ca3af] mb-2.5">
        <Inbox className="w-4 h-4" />
      </div>
      <h4 className="text-[13px] font-medium text-white">{title}</h4>
      {description && <p className="text-xs text-[#9ca3af] mt-1 max-w-[200px]">{description}</p>}
      {cta && (
        <Button
          variant="outline"
          size="sm"
          onClick={cta.onClick}
          className="mt-3 text-xs h-7 px-3 border-[#2a2b31] hover:bg-[#2a2b31] text-indigo-400"
        >
          {cta.label}
        </Button>
      )}
    </Card>
  );
};

export interface ErrorCardProps {
  title?: string;
  message?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

export const ErrorCard: React.FC<ErrorCardProps> = ({
  title = 'Failed to load widget',
  message,
  error,
  onRetry,
  className = '',
}) => {
  let displayMessage = message;
  if (!displayMessage && error) {
    if (error instanceof ApiError) {
      displayMessage = error.message;
    } else if (error instanceof Error) {
      displayMessage = error.message;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      displayMessage = String((error as any).message);
    } else if (typeof error === 'string') {
      displayMessage = error;
    }
  }
  if (!displayMessage) {
    displayMessage = 'Could not connect to service. Check network or server status.';
  }

  return (
    <Card
      className={`p-5 rounded-[12px] bg-[#1e1f24] border border-rose-500/30 flex flex-col justify-between min-h-[140px] transition-all ${className}`}
      role="alert"
    >
      <div>
        <div className="flex items-center gap-2 mb-2 text-rose-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="text-[13px] font-medium">{title}</span>
        </div>
        <p className="text-xs text-[#9ca3af] line-clamp-2 leading-relaxed">
          {displayMessage}
        </p>
      </div>

      {onRetry && (
        <div className="mt-3 pt-2.5 border-t border-[#2a2b31]/60 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 font-mono">Service offline</span>
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-[#2a2b31]/80 hover:bg-[#2a2b31] text-indigo-300 hover:text-indigo-200 border border-[#2a2b31] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}
    </Card>
  );
};

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class WidgetErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Widget render error caught by boundary:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <ErrorCard
          title="Render error"
          message={this.state.error?.message || 'Component failed to render.'}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}

export interface WidgetShellProps<TData> {
  query: WidgetQueryLike<TData>;
  skeleton: React.ReactNode;
  isEmpty?: (data: TData) => boolean;
  empty?: React.ReactNode;
  error?: React.ReactNode | ((error: unknown, refetch: () => void) => React.ReactNode);
  children: (data: TData) => React.ReactNode;
}

export function WidgetShell<TData>({
  query,
  skeleton,
  isEmpty,
  empty,
  error,
  children,
}: WidgetShellProps<TData>): React.ReactElement {
  if (query.isLoading) {
    return <>{skeleton}</>;
  }

  if (query.isError) {
    if (typeof error === 'function') {
      return <>{error(query.error, () => query.refetch())}</>;
    }
    if (error) {
      return <>{error}</>;
    }
    return (
      <ErrorCard
        error={query.error}
        onRetry={() => {
          query.refetch();
        }}
      />
    );
  }

  if (query.data !== undefined && isEmpty && isEmpty(query.data)) {
    return <>{empty || <EmptyState title="No data available" />}</>;
  }

  return (
    <WidgetErrorBoundary onReset={() => query.refetch()}>
      <div className="tabular-nums">
        {children(query.data as TData)}
      </div>
    </WidgetErrorBoundary>
  );
}

export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('en-IN').format(num);
};

export const formatPercentage = (num: number, decimals: number = 1): string => {
  return `${num.toFixed(decimals)}%`;
};
