import React from 'react';

interface ScannerReticleProps {
  isScanning?: boolean;
}

export const ScannerReticle: React.FC<ScannerReticleProps> = ({ isScanning = true }) => {
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center" style={{ zIndex: 10 }}>
      <div className="relative w-56 h-56 sm:w-64 sm:h-64">
        {/* Corner Brackets */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-emerald-400 rounded-tl-xl shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
        <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-emerald-400 rounded-tr-xl shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-emerald-400 rounded-bl-xl shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-emerald-400 rounded-br-xl shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
        
        {/* Subtle bounding guide box */}
        <div className="absolute inset-0 border border-emerald-400/20 rounded-xl" />

        {/* Laser Sweep Line */}
        {isScanning && (
          <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse top-1/2 -translate-y-1/2" />
        )}
      </div>
    </div>
  );
};
