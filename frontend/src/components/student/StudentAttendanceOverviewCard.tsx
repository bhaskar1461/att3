import React from 'react';
import { Camera, BookOpen, AlertTriangle } from 'lucide-react';

interface StudentAttendanceOverviewCardProps {
  isInsufficientData: boolean;
  hasConducted: boolean;
  currentBand: string;
  displayOverall: string;
  strokeDashoffset: number;
  presentCount: number;
  displayAbsent: string | number;
  compAgg: any;
  onOpenScanner: () => void;
  onOpenSubjectModal: () => void;
}

export const StudentAttendanceOverviewCard: React.FC<StudentAttendanceOverviewCardProps> = ({
  isInsufficientData,
  hasConducted,
  currentBand,
  displayOverall,
  strokeDashoffset,
  presentCount,
  displayAbsent,
  compAgg,
  onOpenScanner,
  onOpenSubjectModal,
}) => {
  return (
    <div className="col-span-1 md:col-span-5 bg-white rounded-2xl p-6 border border-[#D2D2D7] shadow-sm flex flex-col justify-between">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="font-bold text-lg text-[#001e40] font-geist leading-tight">JNTUH R25 Attendance</h3>
          <p className="text-[11px] text-[#5e5e63]">Server-Authoritative Status</p>
        </div>
        {isInsufficientData ? (
          <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-black rounded-full border border-blue-200 flex items-center gap-1">
            ℹ️ INITIAL PHASE
          </span>
        ) : hasConducted ? (
          <span className={`px-2.5 py-1 text-xs font-black rounded-full border flex items-center gap-1 ${
            currentBand === 'ELIGIBLE'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300' 
              : currentBand === 'CONDONABLE'
              ? 'bg-amber-50 text-amber-700 border-amber-300'
              : 'bg-rose-50 text-rose-700 border-rose-300'
          }`}>
            {currentBand === 'ELIGIBLE' ? '✅ ELIGIBLE' : currentBand === 'CONDONABLE' ? '⚠️ CONDONABLE' : '⛔ DETAINED'}
          </span>
        ) : (
          <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-200">
            Ready for Class
          </span>
        )}
      </div>

      <div className="flex flex-col items-center justify-center py-2">
        <div className="relative w-32 h-32 mb-4">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" fill="none" stroke="#e0dfe4" strokeWidth="8" strokeLinecap="round" />
            <circle 
              cx="50" 
              cy="50" 
              r="45" 
              fill="none" 
              stroke={isInsufficientData ? '#2f53d7' : (currentBand === 'ELIGIBLE' ? '#24A249' : currentBand === 'CONDONABLE' ? '#FF9F0A' : '#E22126')} 
              strokeWidth="8" 
              strokeDasharray="282.7" 
              strokeDashoffset={strokeDashoffset} 
              strokeLinecap="round" 
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-extrabold text-[#001e40] font-geist">{displayOverall}</span>
            <span className={`text-[10px] font-black uppercase tracking-wider ${
              isInsufficientData ? 'text-blue-700' : (currentBand === 'ELIGIBLE' ? 'text-emerald-700' : currentBand === 'CONDONABLE' ? 'text-amber-700' : 'text-rose-700')
            }`}>
              {isInsufficientData ? 'Initial Phase' : (hasConducted ? currentBand : 'New Session')}
            </span>
          </div>
        </div>

        <div className="w-full grid grid-cols-2 gap-3 mt-2">
          <div className="bg-[#F5F5F7] rounded-xl p-3 text-center border border-[#D2D2D7]">
            <span className="block text-[11px] font-bold text-[#5e5e63] mb-0.5">Present</span>
            <span className="block text-lg font-bold text-[#24A249]">{presentCount}</span>
          </div>
          <div className="bg-[#F5F5F7] rounded-xl p-3 text-center border border-[#D2D2D7]">
            <span className="block text-[11px] font-bold text-[#5e5e63] mb-0.5">Absent</span>
            <span className="block text-lg font-bold text-[#E22126]">{displayAbsent}</span>
          </div>
        </div>

        {currentBand === 'CONDONABLE' && (
          <div className="w-full mt-2 p-2 rounded-xl bg-amber-50 border border-amber-200 text-center text-xs text-amber-900 font-semibold flex items-center justify-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>Condonation Fine Status: <b className="uppercase">{compAgg?.condonation_status || 'Pending'}</b></span>
          </div>
        )}

        {!hasConducted && (
          <p className="text-[10px] text-center text-[#5e5e63] mt-2 font-medium">
            Tracking begins with today's live session
          </p>
        )}
      </div>

      <div className="space-y-2 mt-4">
        <button 
          onClick={onOpenScanner}
          className="w-full py-3 bg-gradient-to-r from-amber-500 via-[#FF9F0A] to-orange-500 hover:opacity-95 text-[#001e40] font-bold text-sm rounded-xl transition shadow-md flex items-center justify-center gap-2 active:scale-98"
        >
          <Camera className="w-5 h-5 text-[#001e40]" />
          Scan Classroom QR
        </button>
        <button 
          onClick={onOpenSubjectModal}
          className="w-full py-2 bg-[#F5F5F7] hover:bg-[#e0dfe4] text-[#001e40] font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5"
        >
          <BookOpen className="w-3.5 h-3.5 text-[#3a5f94]" />
          Subject Breakdown
        </button>
      </div>
    </div>
  );
};
