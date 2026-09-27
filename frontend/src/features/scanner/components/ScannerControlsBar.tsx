import React from 'react';
import { Camera, Flashlight, RefreshCw, X, HelpCircle } from 'lucide-react';

interface ScannerControlsBarProps {
  hasTorchCapability: boolean;
  torchActive: boolean;
  isFlipDisabled?: boolean;
  onToggleTorch: () => void;
  onToggleFacingMode: () => void;
  onOpenHelp?: () => void;
  onClose: () => void;
}

export const ScannerControlsBar: React.FC<ScannerControlsBarProps> = ({
  hasTorchCapability,
  torchActive,
  isFlipDisabled = false,
  onToggleTorch,
  onToggleFacingMode,
  onOpenHelp,
  onClose
}) => {
  return (
    <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-auto" style={{ zIndex: 50 }}>
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-black/50 backdrop-blur-md rounded-full text-white/90 text-xs font-medium border border-white/10 shadow-sm">
        <Camera className="w-3.5 h-3.5 text-emerald-400" />
        <span>Scan Classroom QR</span>
      </div>

      <div className="flex items-center gap-2">
        {onOpenHelp && (
          <button
            type="button"
            onClick={onOpenHelp}
            className="p-2 rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition shadow-sm cursor-pointer"
            title="Help & manual fallback"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        )}

        {hasTorchCapability && (
          <button
            type="button"
            onClick={onToggleTorch}
            className={`p-2 rounded-full backdrop-blur-md transition shadow-sm cursor-pointer ${
              torchActive
                ? 'bg-amber-400 text-slate-950 shadow-amber-400/30'
                : 'bg-black/50 text-white/80 hover:text-white border border-white/10'
            }`}
            title={torchActive ? 'Turn off torch' : 'Turn on torch'}
          >
            <Flashlight className="w-4 h-4" />
          </button>
        )}

        {!isFlipDisabled && (
          <button
            type="button"
            onClick={onToggleFacingMode}
            className="p-2 rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition shadow-sm cursor-pointer"
            title="Flip camera"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition shadow-sm cursor-pointer"
          title="Close scanner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
