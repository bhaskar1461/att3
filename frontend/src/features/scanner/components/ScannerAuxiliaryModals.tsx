import React from 'react';
import { ScannerFallbackInputModal } from './ScannerFallbackInputModal';
import { ScannerHelpSheetModal } from './ScannerHelpSheetModal';
import { ScannerRollCardModal } from './ScannerRollCardModal';
import { ScannerRebindOtpModal } from './ScannerRebindOtpModal';
import { PostAttendanceSelfieModal } from '../../../components/PostAttendanceSelfieModal';
import { useAttendanceSubmission } from '../hooks/useAttendanceSubmission';

export interface ScannerAuxiliaryModalsProps {
  showFallbackInput: boolean;
  setShowFallbackInput: (show: boolean) => void;
  showHelpSheet: boolean;
  setShowHelpSheet: (show: boolean) => void;
  showRollCard: boolean;
  setShowRollCard: (show: boolean) => void;
  submission: ReturnType<typeof useAttendanceSubmission>;
  studentRoll?: string;
  onScanComplete?: (result?: any) => void;
}

export const ScannerAuxiliaryModals: React.FC<ScannerAuxiliaryModalsProps> = ({
  showFallbackInput,
  setShowFallbackInput,
  showHelpSheet,
  setShowHelpSheet,
  showRollCard,
  setShowRollCard,
  submission,
  studentRoll,
  onScanComplete
}) => {
  return (
    <>
      <ScannerFallbackInputModal
        isOpen={showFallbackInput}
        fallbackCode={submission.fallbackCode}
        fallbackSubmitting={submission.fallbackSubmitting}
        fallbackError={submission.fallbackError}
        onCodeChange={submission.setFallbackCode}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await submission.handleFallbackSubmit();
            setShowFallbackInput(false);
            setShowHelpSheet(false);
          } catch {}
        }}
        onClose={() => setShowFallbackInput(false)}
      />

      <ScannerHelpSheetModal
        isOpen={showHelpSheet}
        onOpenManualCode={() => setShowFallbackInput(true)}
        onOpenRollCard={() => setShowRollCard(true)}
        onClose={() => setShowHelpSheet(false)}
      />

      <ScannerRollCardModal
        isOpen={showRollCard}
        studentInfo={submission.studentInfo}
        studentRoll={studentRoll}
        onClose={() => setShowRollCard(false)}
      />

      <ScannerRebindOtpModal
        isOpen={submission.rebindOtpRequired}
        rebindOtpValue={submission.rebindOtpValue}
        rebindMaskedEmail={submission.rebindMaskedEmail}
        rebindOtpError={submission.rebindOtpError}
        isSubmittingRebindOtp={submission.isSubmittingRebindOtp}
        onOtpChange={submission.setRebindOtpValue}
        onConfirm={submission.handleConfirmRebindOtp}
        onResend={submission.handleResendRebindOtp}
        onClose={() => {
          submission.setRebindOtpRequired(false);
          submission.setScanError(null);
        }}
      />

      {submission.showSelfieModal && (submission.selfieAttendanceId || submission.selfieSessionId) && (
        <PostAttendanceSelfieModal
          attendanceId={submission.selfieAttendanceId || submission.selfieSessionId || 1}
          sessionId={submission.selfieSessionId || submission.successResult?.session_id}
          rollNumber={submission.studentInfo.roll_number || studentRoll || 'STUDENT'}
          studentName={submission.studentInfo.name}
          subjectName={submission.successResult?.subject_name}
          onComplete={() => {
            submission.setSelfieCompleted(true);
            submission.setShowSelfieModal(false);
            if (onScanComplete) onScanComplete(submission.successResult);
          }}
          onSkip={() => {
            submission.setShowSelfieModal(false);
            if (onScanComplete) onScanComplete(submission.successResult);
          }}
        />
      )}
    </>
  );
};
