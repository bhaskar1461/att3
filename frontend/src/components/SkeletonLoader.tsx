import React from 'react';

export const CardSkeleton: React.FC<{ height?: string }> = ({ height = 'h-32' }) => (
  <div className={`bg-slate-100 dark:bg-slate-800/60 rounded-2xl animate-pulse p-5 border border-slate-200/80 ${height}`}>
    <div className="h-4 bg-slate-200 dark:bg-slate-700/60 rounded-lg w-1/3 mb-3"></div>
    <div className="h-8 bg-slate-300 dark:bg-slate-600/60 rounded-lg w-1/2 mb-2"></div>
    <div className="h-3 bg-slate-200 dark:bg-slate-700/60 rounded-lg w-2/3"></div>
  </div>
);

export const DashboardSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fadeIn">
    {/* Header Skeleton */}
    <div className="bg-slate-100 rounded-3xl p-8 animate-pulse border border-slate-200">
      <div className="h-4 bg-slate-200 rounded-full w-32 mb-3"></div>
      <div className="h-8 bg-slate-300 rounded-xl w-64 mb-2"></div>
      <div className="h-4 bg-slate-200 rounded-lg w-96"></div>
    </div>

    {/* Stat Cards Grid */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      <CardSkeleton height="h-36" />
      <CardSkeleton height="h-36" />
      <CardSkeleton height="h-36" />
    </div>

    {/* Timetable Card List Skeleton */}
    <div className="bg-slate-100 rounded-3xl p-6 border border-slate-200 space-y-4">
      <div className="h-5 bg-slate-200 rounded-lg w-48 mb-4"></div>
      {[1, 2, 3].map(i => (
        <div key={i} className="h-20 bg-slate-200/70 rounded-2xl animate-pulse"></div>
      ))}
    </div>
  </div>
);

export const RegisterTableSkeleton: React.FC = () => (
  <div className="space-y-4 p-4 animate-pulse">
    <div className="flex items-center justify-between gap-4">
      <div className="h-10 bg-slate-200 rounded-xl w-64"></div>
      <div className="h-10 bg-slate-200 rounded-xl w-48"></div>
    </div>
    <div className="bg-slate-100 rounded-2xl p-4 space-y-3">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
        <div key={i} className="h-10 bg-slate-200/80 rounded-xl"></div>
      ))}
    </div>
  </div>
);

export const QRSkeleton: React.FC = () => (
  <div className="flex flex-col items-center justify-center p-8 space-y-4 animate-pulse">
    <div className="w-64 h-64 bg-slate-200 rounded-2xl border-4 border-slate-300"></div>
    <div className="h-4 bg-slate-200 rounded-lg w-48"></div>
    <div className="h-8 bg-slate-300 rounded-xl w-36"></div>
  </div>
);
