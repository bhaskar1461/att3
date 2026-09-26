import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCheck } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { useTodayRecords } from '../../../features/attendance/hooks';
import { presentCount } from '../../../features/overview/selectors';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../components/ui/tooltip';

export const PresentTodayPill: React.FC = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const scope = role === 'teacher' ? 'mine' : 'all';

  const { data, isError } = useTodayRecords({
    scope,
    pollMs: 60_000,
  });

  const count = data ? presentCount(data) : null;
  const prevCountRef = useRef<number | null>(null);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (count !== null) {
      if (prevCountRef.current !== null && prevCountRef.current !== count) {
        setPulsing(true);
        const timer = setTimeout(() => setPulsing(false), 700);
        return () => clearTimeout(timer);
      }
      prevCountRef.current = count;
    }
  }, [count]);

  const todayStr = new Date().toISOString().split('T')[0];

  const handleClick = () => {
    navigate(`/attendance/day?date=${todayStr}`);
  };

  // Graceful degradation when backend is unreachable or error occurs
  if (isError || count === null) {
    return (
      <Tooltip position="bottom">
        <TooltipTrigger asChild>
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1e1f24]/80 border border-[#2a2b31] text-xs text-slate-400 opacity-75 cursor-default select-none transition-all"
            aria-label="Live feed unavailable"
          >
            <UserCheck className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-medium text-slate-400 tracking-tight text-[11px] sm:text-xs">
              Present today: <span className="text-slate-500">—</span>
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">Live feed unavailable</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Present today: ${count}. Click to view daily register`}
      className={`group flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1e1f24] hover:bg-[#25262c] border border-[#2a2b31] hover:border-emerald-500/40 text-xs shadow-sm cursor-pointer select-none transition-all duration-300 ${
        pulsing ? 'scale-105 border-emerald-500/60 ring-2 ring-emerald-500/30' : ''
      }`}
    >
      <span className="flex h-2 w-2 relative">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <UserCheck className="w-3.5 h-3.5 text-emerald-400 group-hover:text-emerald-300 transition-colors" />
      <span className="font-semibold text-slate-200 group-hover:text-white tracking-tight text-[11px] sm:text-xs">
        Present today:{' '}
        <span className="font-mono tabular-nums text-emerald-400 font-bold ml-0.5">
          {count}
        </span>
      </span>
    </button>
  );
};
