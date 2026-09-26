import React from 'react';
import {
  FileSpreadsheet,
  BarChart2,
  Lightbulb
} from 'lucide-react';

interface ClassPanelQuickActionsProps {
  onOpenExcelRegister?: () => void;
  onOpenReports?: () => void;
}

export const ClassPanelQuickActions: React.FC<ClassPanelQuickActionsProps> = ({
  onOpenExcelRegister,
  onOpenReports
}) => {
  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
          Quick Actions
        </h4>

        <div className="grid grid-cols-2 gap-2">
          {onOpenExcelRegister && (
            <button
              onClick={onOpenExcelRegister}
              className="p-3 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 text-slate-700 hover:text-emerald-800 transition text-left group active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
            >
              <div className="flex items-center gap-2 mb-1">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold">Register Export</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                Download formatted weekly attendance
              </p>
            </button>
          )}

          {onOpenReports && (
            <button
              onClick={onOpenReports}
              className="p-3 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 text-slate-700 hover:text-[#2f53d7] transition text-left group active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f53d7] cursor-pointer"
            >
              <div className="flex items-center gap-2 mb-1">
                <BarChart2 className="w-4 h-4 text-[#2f53d7] group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold">Reports</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                Subject & section analytics
              </p>
            </button>
          )}
        </div>
      </div>

      {/* Pro Tip Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50/60 rounded-2xl p-4 border border-blue-100 flex items-start gap-3">
        <Lightbulb className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-600 leading-relaxed">
          <span className="font-extrabold text-[#001e40]">Pro Tip:</span> Tap any period box in the daily timeline to inspect its roster, or use the 1-click AM/PM shift buttons to launch block periods seamlessly.
        </div>
      </div>
    </>
  );
};
