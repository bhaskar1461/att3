import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PwaInstallGuard } from './PwaInstallGuard';
import { DisplayType } from '../types/telemetry';

// Extracted Custom Hooks
import { useGeoVerification } from '../features/scanner/hooks/useGeoVerification';
import { useCameraStream } from '../features/scanner/hooks/useCameraStream';
import { useBarcodeScanner } from '../features/scanner/hooks/useBarcodeScanner';
import { useAttendanceSubmission, ScannerFlowState } from '../features/scanner/hooks/useAttendanceSubmission';

// Extracted UI Subcomponents
import { ScannerReticle } from '../features/scanner/components/ScannerReticle';
import { ScannerControlsBar } from '../features/scanner/components/ScannerControlsBar';
import { ScannerZoomPills } from '../features/scanner/components/ScannerZoomPills';
import { ScannerFeedbackOverlay, ScannerBottomPanel } from '../features/scanner/components/ScannerFeedbackOverlay';
import { ScannerSuccessCard } from '../features/scanner/components/ScannerSuccessCard';
import { ScannerOfflineQueuedCard } from '../features/scanner/components/ScannerOfflineQueuedCard';
import { ScannerAuxiliaryModals } from '../features/scanner/components/ScannerAuxiliaryModals';

export type { ScannerFlowState };

export interface StudentClassScannerModalProps {
  onClose: () => void;
  onScanComplete: (result?: any) => void;
  displayType?: DisplayType;
  studentRoll?: string;
}

export const StudentClassScannerModal: React.FC<StudentClassScannerModalProps> = ({
  onClose,
  onScanComplete,
  displayType = 'projector',
  studentRoll
}) => {
  const [showFallbackInput, setShowFallbackInput] = useState<boolean>(false);
  const [showHelpSheet, setShowHelpSheet] = useState<boolean>(false);
  const [showRollCard, setShowRollCard] = useState<boolean>(false);

  const isDebugMode = useMemo(() => {
    return typeof window !== 'undefined' && (
      new URLSearchParams(window.location.search).get('debug') === '1' ||
      localStorage.getItem('scanner_debug') === '1'
    );
  }, []);

  const geo = useGeoVerification();
  const camera = useCameraStream({ displayType });
  const submission = useAttendanceSubmission({
    studentRoll,
    getStudentGeolocation: geo.getStudentGeolocation,
    studentGeoRef: geo.studentGeoRef,
    onScanComplete,
    onStopCamera: camera.stopCamera,
    onGuideChange: (text) => scanner.setGuideText(text),
    onNextScanReady: () => scanner.triggerNextFrame(),
    isDebugMode
  });

  const isScanningLocked =
    submission.isSubmitting ||
    submission.flowState === 'SUBMITTING' ||
    submission.flowState === 'RATE_LIMITED' ||
    submission.isScanningLockedRef.current;

  const scanner = useBarcodeScanner({
    videoRef: camera.videoRef,
    isScanningLocked,
    onScanSuccess: submission.handleScanSuccess,
    triggerAutoZoomIfNeeded: camera.triggerAutoZoomIfNeeded,
    barcodeDetector: camera.barcodeDetectorRef.current,
    displayType,
    isDebugMode
  });

  useEffect(() => {
    if (camera.cameraActive) {
      scanner.startScanning();
    } else {
      scanner.stopScanning();
    }
  }, [camera.cameraActive]);

  const handleClose = useCallback(() => {
    camera.stopCamera();
    scanner.stopScanning();
    onClose();
  }, [camera, scanner, onClose]);

  return (
    <PwaInstallGuard onDismiss={handleClose}>
      <div 
        className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div 
          className="bg-white text-slate-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[90vh] font-sans border border-slate-100 flex-shrink-0"
          style={{ overscrollBehavior: 'contain' }}
        >
          {submission.isOfflineQueued ? (
            <ScannerOfflineQueuedCard
              queuedSessionInfo={submission.queuedSessionInfo}
              pendingQueueCount={submission.pendingQueueCount}
              isRetryingQueue={submission.isRetryingQueue}
              onRetryQueue={submission.retryOfflineQueue}
              onDone={() => {
                onScanComplete(submission.queuedSessionInfo || { status: 'OFFLINE_QUEUED' });
                handleClose();
              }}
            />
          ) : submission.successResult ? (
            <ScannerSuccessCard
              successResult={submission.successResult}
              studentInfo={submission.studentInfo}
              studentRoll={studentRoll}
              selfieAttendanceId={submission.selfieAttendanceId}
              selfieSessionId={submission.selfieSessionId}
              selfieCompleted={submission.selfieCompleted}
              onOpenSelfie={() => submission.setShowSelfieModal(true)}
              onDone={() => {
                onScanComplete(submission.successResult);
                handleClose();
              }}
            />
          ) : (
            <div className="w-full flex flex-col items-center">
              <div 
                className="relative w-full h-[58vh] sm:h-[420px] min-h-[320px] bg-black overflow-hidden select-none flex items-center justify-center"
                style={{ touchAction: 'none', aspectRatio: 'var(--qr-viewfinder-ar, 4/3)' }}
                onTouchStart={camera.handleTouchStart}
                onTouchMove={camera.handleTouchMove}
                onTouchEnd={camera.handleTouchEnd}
                onDoubleClick={camera.handleDoubleTap}
              >
                <video
                  ref={camera.attachVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ zIndex: 1, transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
                />

                <ScannerControlsBar
                  hasTorchCapability={camera.hasTorchCapability}
                  torchActive={camera.torchActive}
                  onToggleTorch={camera.toggleTorch}
                  onToggleFacingMode={camera.toggleFacingMode}
                  isFlipDisabled={submission.flowState === 'SUBMITTING' || submission.flowState === 'ENROLLING'}
                  onOpenHelp={() => setShowHelpSheet(true)}
                  onClose={handleClose}
                />

                <ScannerReticle isScanning={camera.cameraActive && !submission.isSubmitting} />

                <ScannerZoomPills
                  hasZoomCapability={camera.hasZoomCapability}
                  zoomRange={camera.zoomRange}
                  currentZoom={camera.currentZoom}
                  onApplyZoom={camera.applyZoom}
                />

                <ScannerFeedbackOverlay
                  flowState={submission.flowState}
                  submittingStage={submission.submittingStage}
                  errorInfo={submission.errorInfo}
                  guideText={scanner.guideText}
                  cameraStarting={camera.cameraStarting}
                  cameraError={camera.cameraError}
                  permissionState={camera.permissionState}
                  isCameraInUse={camera.isCameraInUse}
                  browserInfo={camera.browserInfo}
                  copiedSafariLink={camera.copiedSafariLink}
                  rateLimitSecondsLeft={submission.rateLimitSecondsLeft}
                  scanError={submission.scanError}
                  scanErrorCode={submission.scanErrorCode}
                  isInlineEnrolling={submission.isInlineEnrolling}
                  rebindMaskedEmail={submission.rebindMaskedEmail}
                  onCancelSubmitting={submission.cancelSubmission}
                  onResetAfterTimeoutOrStale={submission.resetAfterTimeoutOrStale}
                  onInlineEnroll={submission.handleInlineEnroll}
                  onRetrySubmit={submission.retrySubmit}
                  onCopySafariLink={camera.handleCopySafariLink}
                  onShowRollCard={() => setShowRollCard(true)}
                  onClose={handleClose}
                />
              </div>

              <ScannerBottomPanel
                flowState={submission.flowState}
                guideText={scanner.guideText}
                cameraError={camera.cameraError}
                permissionState={camera.permissionState}
                isCameraInUse={camera.isCameraInUse}
                browserInfo={camera.browserInfo}
                copiedSafariLink={camera.copiedSafariLink}
                rateLimitSecondsLeft={submission.rateLimitSecondsLeft}
                scanError={submission.scanError}
                scanErrorCode={submission.scanErrorCode}
                isInlineEnrolling={submission.isInlineEnrolling}
                rebindMaskedEmail={submission.rebindMaskedEmail}
                onResetAfterTimeoutOrStale={submission.resetAfterTimeoutOrStale}
                onInlineEnroll={submission.handleInlineEnroll}
                onCopySafariLink={camera.handleCopySafariLink}
                onShowRollCard={() => setShowRollCard(true)}
                onClose={handleClose}
              />
            </div>
          )}

          <ScannerAuxiliaryModals
            showFallbackInput={showFallbackInput}
            setShowFallbackInput={setShowFallbackInput}
            showHelpSheet={showHelpSheet}
            setShowHelpSheet={setShowHelpSheet}
            showRollCard={showRollCard}
            setShowRollCard={setShowRollCard}
            submission={submission}
            studentRoll={studentRoll}
            onScanComplete={onScanComplete}
          />
        </div>
      </div>
    </PwaInstallGuard>
  );
};

export default StudentClassScannerModal;
