import React from 'react';
import {
  useProjectorRotatingQr,
  ProjectorHeaderAlerts,
  ProjectorSessionEndedOverlay,
  ProjectorPresentationView,
  ProjectorStandardView,
} from './projector';

interface ProjectorBroadcastModalProps {
  sessionId: number;
  initialPeriodCount?: number;
  onClose: () => void;
  onLockSession?: () => void;
}

export const ProjectorBroadcastModal: React.FC<ProjectorBroadcastModalProps> = ({
  sessionId,
  initialPeriodCount = 1,
  onClose,
  onLockSession,
}) => {
  const {
    data,
    loading,
    error,
    setError,
    setLoading,
    secondsRemaining,
    isStale,
    isFullscreen,
    toggleFullscreen,
    isLocking,
    handleLock,
    isFullScreenQrMode,
    setIsFullScreenQrMode,
    wakeLockActive,
    isSessionEnded,
    showResyncedToast,
    isDarkRoom,
    toggleDarkRoom,
    currentQr,
    incomingQr,
    isCrossfading,
    showControls,
    setShowControls,
    handleUserActivity,
    modalContainerRef,
    fetchBroadcastToken,
    circleRadius,
    circumference,
    strokeDashoffset,
    progressPercent,
    isPhoneDisplay,
  } = useProjectorRotatingQr({
    sessionId,
    initialPeriodCount,
    onLockSession,
    onClose,
  });

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    fetchBroadcastToken();
  };

  return (
    <div
      ref={modalContainerRef}
      onMouseMove={handleUserActivity}
      onTouchStart={handleUserActivity}
      onClick={() => {
        if (!showControls) setShowControls(true);
      }}
      className={`fixed inset-0 z-50 flex flex-col justify-between overflow-hidden font-sans select-none transition-colors duration-500 ${
        isDarkRoom ? 'bg-black text-white' : 'bg-[#000d1a] text-white'
      }`}
    >
      <ProjectorHeaderAlerts
        showResyncedToast={showResyncedToast}
        wakeLockActive={wakeLockActive}
        isSessionEnded={isSessionEnded}
        showControls={showControls}
        isStale={isStale}
        onRetry={() => fetchBroadcastToken()}
      />

      {isSessionEnded ? (
        <ProjectorSessionEndedOverlay
          sessionId={sessionId}
          data={data}
          onClose={onClose}
        />
      ) : isFullScreenQrMode ? (
        <ProjectorPresentationView
          data={data}
          isDarkRoom={isDarkRoom}
          showControls={showControls}
          wakeLockActive={wakeLockActive}
          isFullscreen={isFullscreen}
          isLocking={isLocking}
          isPhoneDisplay={isPhoneDisplay}
          loading={loading}
          error={error}
          currentQr={currentQr}
          incomingQr={incomingQr}
          isCrossfading={isCrossfading}
          secondsRemaining={secondsRemaining}
          circleRadius={circleRadius}
          circumference={circumference}
          strokeDashoffset={strokeDashoffset}
          toggleDarkRoom={toggleDarkRoom}
          setIsFullScreenQrMode={setIsFullScreenQrMode}
          toggleFullscreen={toggleFullscreen}
          handleLock={handleLock}
          onClose={onClose}
          onRetry={handleRetry}
        />
      ) : (
        <ProjectorStandardView
          data={data}
          isDarkRoom={isDarkRoom}
          isFullscreen={isFullscreen}
          isLocking={isLocking}
          loading={loading}
          error={error}
          currentQr={currentQr}
          secondsRemaining={secondsRemaining}
          progressPercent={progressPercent}
          setIsFullScreenQrMode={setIsFullScreenQrMode}
          toggleDarkRoom={toggleDarkRoom}
          toggleFullscreen={toggleFullscreen}
          handleLock={handleLock}
          onClose={onClose}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
};
