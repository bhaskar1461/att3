import React, { useEffect, useState } from 'react';
import { subscribeMockHits, getMockHitsCount } from '../../core/api/client';

export const MockBanner: React.FC = () => {
  const [mockCount, setMockCount] = useState(getMockHitsCount);

  useEffect(() => {
    return subscribeMockHits((count) => {
      setMockCount(count);
    });
  }, []);

  if (!import.meta.env.DEV || mockCount === 0) {
    return null;
  }

  return (
    <div
      id="dev-mock-pill"
      className="fixed bottom-4 right-4 z-50 px-3 py-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-mono font-medium shadow-lg backdrop-blur-md flex items-center gap-2 pointer-events-none transition-all duration-200"
    >
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      <span>MOCK: {mockCount} {mockCount === 1 ? 'endpoint' : 'endpoints'}</span>
    </div>
  );
};
