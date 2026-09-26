import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Eye, Download, Loader2 } from 'lucide-react';
import type { HistoricalSession } from '../../../core/api/schemas/sessions';
import { useReportDownload } from '../../reports/hooks';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../components/ui/tooltip';

interface RegistersTableProps {
  sessions: HistoricalSession[];
}

const RegisterRow: React.FC<{ session: HistoricalSession }> = ({ session }) => {
  const navigate = useNavigate();
  const [kebabOpen, setKebabOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement | null>(null);

  const { downloadReport, isDownloading } = useReportDownload({
    type: 'register',
    session_id: session.session_id,
  });

  useEffect(() => {
    if (!kebabOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setKebabOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [kebabOpen]);

  const present = session.present_count ?? 0;
  const manual = session.manual_count ?? 0;
  const qr = Math.max(0, present - manual);
  const ble = 0; // BLE/Self check-in placeholder
  const isFinal = session.status === 'LOCKED' || session.status === 'CLOSED';

  const handleView = () => {
    setKebabOpen(false);
    navigate(`/attendance/day?date=${session.session_date}&session=${session.session_id}`);
  };

  const handleExport = async () => {
    setKebabOpen(false);
    await downloadReport();
  };

  return (
    <tr className="hover:bg-[#25262c]/60 transition-colors border-b border-[#2a2b31]/40 last:border-0">
      {/* Date */}
      <td className="py-2.5 px-3 text-xs font-mono text-slate-300 whitespace-nowrap">
        {session.session_date}
      </td>

      {/* Class */}
      <td className="py-2.5 px-3 text-xs font-medium text-white truncate max-w-[160px]">
        <div className="truncate font-semibold">{session.subject_name}</div>
        <div className="text-[11px] text-slate-400 font-mono">{session.section_name}</div>
      </td>

      {/* Present / Total */}
      <td className="py-2.5 px-3 text-xs font-mono text-slate-200 whitespace-nowrap">
        <span className="font-bold text-emerald-400">{present}</span>
        <span className="text-slate-500"> / {session.total_students}</span>
      </td>

      {/* Method mini-split */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <Tooltip position="top">
          <TooltipTrigger asChild>
            <div className="inline-flex items-center gap-1 cursor-default p-1 rounded bg-[#17181c] border border-[#2a2b31]/60">
              <span
                className="w-2.5 h-2.5 rounded-sm bg-indigo-500"
                aria-label={`QR scans: ${qr}`}
              />
              <span
                className="w-2.5 h-2.5 rounded-sm bg-emerald-500"
                aria-label={`Self/BLE: ${ble}`}
              />
              <span
                className="w-2.5 h-2.5 rounded-sm bg-amber-500"
                aria-label={`Manual: ${manual}`}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="font-mono text-xs">
              QR: {qr} · BLE: {ble} · Manual: {manual}
            </span>
          </TooltipContent>
        </Tooltip>
      </td>

      {/* Status pill (final / draft) */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
            isFinal
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
          }`}
        >
          {isFinal ? 'Final' : 'Draft'}
        </span>
      </td>

      {/* Kebab action menu */}
      <td className="py-2.5 px-3 text-right whitespace-nowrap">
        <div ref={kebabRef} className="relative inline-block text-left">
          <button
            type="button"
            onClick={() => setKebabOpen((prev) => !prev)}
            aria-label="Register row actions"
            className="p-1 rounded-lg hover:bg-[#2a2b31] text-slate-400 hover:text-white transition-colors"
          >
            {isDownloading ? (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            ) : (
              <MoreHorizontal className="w-4 h-4" />
            )}
          </button>

          {kebabOpen && (
            <div className="absolute right-0 mt-1 w-32 rounded-xl bg-[#1e1f24] border border-[#2a2b31] shadow-xl z-20 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
              <button
                type="button"
                onClick={handleView}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:text-white hover:bg-[#25262c] flex items-center gap-2 transition-colors"
              >
                <Eye className="w-3.5 h-3.5 text-slate-400" />
                <span>View</span>
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={isDownloading}
                className="w-full text-left px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-[#25262c] flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {isDownloading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Export</span>
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

export const RegistersTable: React.FC<RegistersTableProps> = ({ sessions }) => {
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const total = sessions.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const displayed = sessions.slice((page - 1) * pageSize, page * pageSize);

  if (total === 0) {
    return (
      <div className="py-12 text-center text-slate-400 text-xs">
        No registers yet — they appear after the first session.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#2a2b31] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-3">Class</th>
              <th className="py-2.5 px-3">Present/Total</th>
              <th className="py-2.5 px-3">Method</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((session) => (
              <RegisterRow key={session.session_id} session={session} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer pagination info */}
      <div className="flex items-center justify-between pt-2 border-t border-[#2a2b31]/40 text-[11px] text-slate-400 px-1">
        <span>
          Showing <span className="font-semibold text-slate-200">{(page - 1) * pageSize + 1}</span> to{' '}
          <span className="font-semibold text-slate-200">{Math.min(page * pageSize, total)}</span> of{' '}
          <span className="font-semibold text-slate-200">{total}</span>
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2 py-0.5 rounded bg-[#1e1f24] hover:bg-[#25262c] border border-[#2a2b31] text-slate-300 disabled:opacity-40 transition-colors"
            >
              Prev
            </button>
            <span className="font-mono text-slate-400 px-1">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2 py-0.5 rounded bg-[#1e1f24] hover:bg-[#25262c] border border-[#2a2b31] text-slate-300 disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
