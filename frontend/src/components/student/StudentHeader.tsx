import React from 'react';

interface StudentHeaderProps {
  profile: any;
}

export const StudentHeader: React.FC<StudentHeaderProps> = ({ profile }) => {
  return (
    <header className="sticky top-0 w-full z-30 flex justify-between items-center px-6 h-16 bg-white/80 backdrop-blur-md border-b border-[#D2D2D7]">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[#001e40] text-white flex items-center justify-center font-bold text-sm">
          {profile?.name ? profile.name.charAt(0) : 'S'}
        </div>
        <div>
          <h2 className="font-bold text-base text-[#001e40] font-geist m-0 leading-tight">SNIST ERP</h2>
          <p className="text-[11px] font-medium text-[#5e5e63]">Academic Portal</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="px-3 py-1 bg-[#F5F5F7] border border-[#D2D2D7] text-[#001e40] text-xs font-mono font-bold rounded-full">
          {profile?.roll_number || 'STUDENT'}
        </span>
      </div>
    </header>
  );
};
