import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'
import { registerTelemetry } from './services/qrEngine'
import { scannerTelemetry } from './services/scannerTelemetry'

// Bootstrap telemetry injection for qrEngine (FIX-11)
registerTelemetry((event, details) => {
  scannerTelemetry.recordStage(event as any, details?.duration || 0, details?.sessionId);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
