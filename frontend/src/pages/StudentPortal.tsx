import React, { useState, useEffect } from 'react';
import { Toast } from '../components/Toast';
import { SmartInstallCard } from '../components/SmartInstallCard';
import {
  useStudentPortalData,
  StudentHeader,
  StudentComplianceAlertBanner,
  StudentClassSpotlight,
  StudentAttendanceActionCard,
  StudentAttendanceOverviewCard,
  StudentTimetableCard,
  StudentOfficialNoticesCard,
  StudentSubjectBreakdownModal,
  StudentMobileNav,
} from '../components/student';

// Lazy-load heavy html5-qrcode scanner modal so students do not download it on initial portal load
const StudentClassScannerModal = React.lazy(() => 
  import('../components/StudentClassScannerModal').then(m => ({ default: m.StudentClassScannerModal }))
);

export const StudentPortal: React.FC = () => {
  const [showSubjectModal, setShowSubjectModal] = useState<boolean>(false);
  const [showClassScannerModal, setShowClassScannerModal] = useState<boolean>(false);
  const [activeNavTab, setActiveNavTab] = useState<'home' | 'attendance' | 'timetable'>('home');

  const {
    profile,
    summary,
    compliance,
    warnings,
    schedule,
    toast,
    setToast,
    isDeviceBound,
    compAgg,
    presentCount,
    displayAbsent,
    hasConducted,
    isInsufficientData,
    displayOverall,
    currentBand,
    myAttendance,
    isMarkedToday,
    unrecoverableCourse,
    primaryRecoveryCourse,
    aggClassesNeeded,
    isAggRecoverable,
    strokeDashoffset,
    getGreeting,
    isLiveSession,
    primarySubject,
    primaryTeacher,
    primaryRoom,
    periodCount,
    handleScanComplete,
    fetchStudentData,
  } = useStudentPortalData();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('scan') === 'true' || params.get('openScanner') === '1') {
      setShowClassScannerModal(true);
    }
  }, []);

  return (
    <div className="bg-[#FBFBFD] text-[#1b1b1d] min-h-screen flex flex-col font-sans">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <StudentHeader profile={profile} />

      <main className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-6 pb-24 md:pb-8">
        <section className="py-2">
          <p className="text-xs font-bold text-[#5e5e63] uppercase tracking-wider mb-1" id="current-date">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#001e40] font-geist">
            {getGreeting()}, {profile?.name ? profile.name.split(' ')[0] : 'Student'}
          </h1>
          <p className="text-xs text-[#5e5e63] mt-0.5">
            {profile ? `${profile.department} • ${profile.section} (${profile.year})` : 'Sreenidhi Institute of Science & Technology'}
          </p>
        </section>

        <SmartInstallCard />

        <StudentComplianceAlertBanner
          isInsufficientData={isInsufficientData}
          hasConducted={hasConducted}
          compAgg={compAgg}
          unrecoverableCourse={unrecoverableCourse}
          primaryRecoveryCourse={primaryRecoveryCourse}
          overallPercent={summary?.overall_percentage ?? 0}
          aggClassesNeeded={aggClassesNeeded}
          isAggRecoverable={isAggRecoverable}
          displayOverall={displayOverall}
        />

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <StudentClassSpotlight
            profile={profile}
            isMarkedToday={isMarkedToday}
            isLiveSession={isLiveSession}
            periodCount={periodCount}
            primarySubject={primarySubject}
            primaryTeacher={primaryTeacher}
            primaryRoom={primaryRoom}
          />

          <StudentAttendanceActionCard
            isMarkedToday={isMarkedToday}
            isLiveSession={isLiveSession}
            myAttendance={myAttendance}
            primarySubject={primarySubject}
            periodCount={periodCount}
            isDeviceBound={isDeviceBound}
            onOpenScanner={() => setShowClassScannerModal(true)}
          />

          <StudentAttendanceOverviewCard
            isInsufficientData={isInsufficientData}
            hasConducted={hasConducted}
            currentBand={currentBand}
            displayOverall={displayOverall}
            strokeDashoffset={strokeDashoffset}
            presentCount={presentCount}
            displayAbsent={displayAbsent}
            compAgg={compAgg}
            onOpenScanner={() => setShowClassScannerModal(true)}
            onOpenSubjectModal={() => setShowSubjectModal(true)}
          />

          <StudentTimetableCard
            schedule={schedule}
            summary={summary}
            isMarkedToday={isMarkedToday}
            isLiveSession={isLiveSession}
            primarySubject={primarySubject}
            primaryTeacher={primaryTeacher}
            primaryRoom={primaryRoom}
            periodCount={periodCount}
            onOpenSubjectModal={() => setShowSubjectModal(true)}
          />

          <StudentOfficialNoticesCard warnings={warnings} />
        </div>
      </main>

      <StudentSubjectBreakdownModal
        isOpen={showSubjectModal}
        onClose={() => setShowSubjectModal(false)}
        compliance={compliance}
        summary={summary}
      />

      <StudentMobileNav
        activeNavTab={activeNavTab}
        setActiveNavTab={setActiveNavTab}
        onOpenScanner={() => setShowClassScannerModal(true)}
        onOpenAttendance={() => setShowSubjectModal(true)}
        onOpenTimetable={() => {
          document.getElementById('timetable-section')?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      {showClassScannerModal && (
        <React.Suspense fallback={null}>
          <StudentClassScannerModal
            studentRoll={profile?.roll_number || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user') || '{}').roll_number : undefined)}
            onClose={() => {
              setShowClassScannerModal(false);
              fetchStudentData();
            }}
            onScanComplete={handleScanComplete}
          />
        </React.Suspense>
      )}
    </div>
  );
};
