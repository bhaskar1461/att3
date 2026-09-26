import React from 'react';
import { Home, PieChart, Camera, Calendar } from 'lucide-react';

interface StudentMobileNavProps {
  activeNavTab: 'home' | 'attendance' | 'timetable';
  setActiveNavTab: (tab: 'home' | 'attendance' | 'timetable') => void;
  onOpenScanner: () => void;
  onOpenAttendance: () => void;
  onOpenTimetable: () => void;
}

export const StudentMobileNav: React.FC<StudentMobileNavProps> = ({
  activeNavTab,
  setActiveNavTab,
  onOpenScanner,
  onOpenAttendance,
  onOpenTimetable,
}) => {
  return (
    <nav className="fixed bottom-0 w-full z-50 flex justify-around items-center px-4 py-2 bg-white/95 backdrop-blur-lg md:hidden border-t border-[#D2D2D7] shadow-lg">
      <button 
        onClick={() => {
          setActiveNavTab('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }} 
        className={`flex flex-col items-center px-3 py-1 font-bold ${activeNavTab === 'home' ? 'text-[#001e40]' : 'text-[#5e5e63]'}`}
      >
        <Home className="w-5 h-5" />
        <span className="text-[10px] mt-0.5">Home</span>
      </button>
      <button 
        onClick={() => {
          setActiveNavTab('attendance');
          onOpenAttendance();
        }} 
        className={`flex flex-col items-center px-3 py-1 hover:text-[#001e40] ${activeNavTab === 'attendance' ? 'text-[#001e40] font-bold' : 'text-[#5e5e63]'}`}
      >
        <PieChart className="w-5 h-5" />
        <span className="text-[10px] mt-0.5">Attendance</span>
      </button>
      <button 
        onClick={onOpenScanner} 
        className="flex flex-col items-center justify-center -mt-5 bg-gradient-to-r from-amber-400 via-[#FF9F0A] to-orange-500 text-[#001e40] w-14 h-14 rounded-full shadow-lg border-4 border-white transition active:scale-95"
        title="Scan Classroom Projector"
      >
        <Camera className="w-6 h-6" />
        <span className="sr-only">Scan</span>
      </button>
      <button 
        onClick={() => {
          setActiveNavTab('timetable');
          onOpenTimetable();
        }} 
        className={`flex flex-col items-center px-3 py-1 hover:text-[#001e40] ${activeNavTab === 'timetable' ? 'text-[#001e40] font-bold' : 'text-[#5e5e63]'}`}
      >
        <Calendar className="w-5 h-5" />
        <span className="text-[10px] mt-0.5">Timetable</span>
      </button>
    </nav>
  );
};
