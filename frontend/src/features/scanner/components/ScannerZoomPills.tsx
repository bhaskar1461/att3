import React from 'react';

interface ScannerZoomPillsProps {
  hasZoomCapability: boolean;
  zoomRange: { min: number; max: number; step: number };
  currentZoom: number;
  onApplyZoom: (val: number) => void;
}

export const ScannerZoomPills: React.FC<ScannerZoomPillsProps> = ({
  hasZoomCapability,
  zoomRange,
  currentZoom,
  onApplyZoom
}) => {
  if (!hasZoomCapability || zoomRange.max < 1.5) return null;

  return (
    <div
      className="absolute bottom-3.5 left-1/2 -translate-x-1/2 flex items-center bg-black/50 backdrop-blur-md rounded-full p-1 border border-white/15 shadow-lg"
      style={{ zIndex: 20 }}
    >
      <button
        type="button"
        onClick={() => onApplyZoom(1)}
        className={`px-3 py-0.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
          Math.abs(currentZoom - 1) < 0.2
            ? 'bg-white text-slate-950 shadow-sm'
            : 'text-white/80 hover:text-white'
        }`}
      >
        1×
      </button>
      <button
        type="button"
        onClick={() => onApplyZoom(Math.min(zoomRange.max, 2))}
        className={`px-3 py-0.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
          Math.abs(currentZoom - 2) < 0.2
            ? 'bg-white text-slate-950 shadow-sm'
            : 'text-white/80 hover:text-white'
        }`}
      >
        2×
      </button>
      {zoomRange.max >= 3 && (
        <button
          type="button"
          onClick={() => onApplyZoom(Math.min(zoomRange.max, 3))}
          className={`px-3 py-0.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
            Math.abs(currentZoom - 3) < 0.2
              ? 'bg-white text-slate-950 shadow-sm'
              : 'text-white/80 hover:text-white'
          }`}
        >
          3×
        </button>
      )}
    </div>
  );
};
