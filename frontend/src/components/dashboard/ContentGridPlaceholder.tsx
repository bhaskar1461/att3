import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Layers,
  Activity,
  Shield,
  ArrowUpRight,
} from 'lucide-react';

export const ContentGridPlaceholder: React.FC = () => {
  return (
    <div className="w-full p-4 sm:p-6 space-y-6">
      
      {/* 12-Column Content Grid: Row 1 — Hero & Highlights */}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        
        {/* Purple Gradient Hero Card (#7c3aed → #a78bfa) */}
        <div className="col-span-12 lg:col-span-8 relative overflow-hidden rounded-[12px] bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] p-6 text-white shadow-xl shadow-purple-500/10 border border-purple-400/30 flex flex-col justify-between min-h-[220px]">
          {/* Subtle geometric background watermark */}
          <div className="absolute -right-8 -bottom-8 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          
          <div className="relative z-10 space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 border border-white/20">
                <Sparkles className="w-3 h-3 text-amber-200" />
                Phase 1 • Dashboard Shell Active
              </span>
              <span className="text-[11px] text-white/80 font-medium">
                SNIST Academic Enterprise
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-tight text-white mt-1">
              University Attendance & Biometric Grid
            </h2>
            <p className="text-xs sm:text-sm text-white/90 max-w-xl leading-relaxed">
              56px Icon Rail, 240px collapsible secondary navigation, server-authoritative IST time enforcement, and dark/light token architecture initialized.
            </p>
          </div>

          <div className="relative z-10 pt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/20 backdrop-blur-md text-white text-xs border border-white/15">
              <Shield className="w-3.5 h-3.5 text-emerald-300" />
              <span className="font-semibold">Canonical Identity: SAP ID</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/20 backdrop-blur-md text-white text-xs border border-white/15">
              <Activity className="w-3.5 h-3.5 text-indigo-200" />
              <span className="font-semibold">30-min Device Lock Enforced</span>
            </div>
          </div>
        </div>

        {/* Top-Right Secondary Metric Card Slot */}
        <Card className="col-span-12 lg:col-span-4 flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardDescription>System Architecture Slot</CardDescription>
              <Badge variant="hero" className="text-[10px]">Active</Badge>
            </div>
            <CardTitle className="text-lg mt-1">Module Grid Placeholder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3.5 rounded-lg bg-[#141416] border border-[#2a2b31] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#9ca3af]">Shell Responsive Spec</span>
                <span className="text-emerald-400 font-semibold font-mono">1440 • 768 • 360</span>
              </div>
              <div className="w-full bg-[#2a2b31] h-1.5 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] h-full w-full rounded-full" />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-[#9ca3af]">Theme State</span>
              <span className="text-indigo-400 font-medium">Dark (Default) / Light</span>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* 12-Column Content Grid: Row 2 — Metric Cards Slots with Delta Pills */}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        
        {/* Metric Slot 1 */}
        <Card className="col-span-12 sm:col-span-6 lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Enrolled Students</CardDescription>
              <Badge variant="deltaPositive">
                <TrendingUp className="w-3 h-3 mr-0.5 inline" /> +12.4%
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-8 w-24 bg-[#2a2b31]/60 rounded-md animate-pulse my-1" />
            <p className="text-[11px] text-[#9ca3af] mt-2">
              Slot ready for enrolled count hook
            </p>
          </CardContent>
        </Card>

        {/* Metric Slot 2 */}
        <Card className="col-span-12 sm:col-span-6 lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Live Present Rate</CardDescription>
              <Badge variant="deltaPositive">
                <TrendingUp className="w-3 h-3 mr-0.5 inline" /> +4.2%
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-8 w-20 bg-[#2a2b31]/60 rounded-md animate-pulse my-1" />
            <p className="text-[11px] text-[#9ca3af] mt-2">
              Slot ready for real-time percentage
            </p>
          </CardContent>
        </Card>

        {/* Metric Slot 3 */}
        <Card className="col-span-12 sm:col-span-6 lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Active Sessions</CardDescription>
              <Badge variant="deltaNegative">
                <TrendingDown className="w-3 h-3 mr-0.5 inline" /> -2.1%
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-8 w-16 bg-[#2a2b31]/60 rounded-md animate-pulse my-1" />
            <p className="text-[11px] text-[#9ca3af] mt-2">
              Slot ready for live classrooms hook
            </p>
          </CardContent>
        </Card>

        {/* Metric Slot 4 */}
        <Card className="col-span-12 sm:col-span-6 lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Biometric Verifications</CardDescription>
              <Badge variant="accent">
                99.8% Match
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-8 w-28 bg-[#2a2b31]/60 rounded-md animate-pulse my-1" />
            <p className="text-[11px] text-[#9ca3af] mt-2">
              Slot ready for face verification telemetry
            </p>
          </CardContent>
        </Card>

      </div>

      {/* 12-Column Content Grid: Row 3 — Main Chart Slot (8-col) & Live Activity Slot (4-col) */}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        
        {/* Main Chart Placeholder (col-span-12 lg:col-span-8) */}
        <Card className="col-span-12 lg:col-span-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Attendance Trends & Session Velocity</CardTitle>
                <CardDescription>12-Column Chart Canvas Placeholder</CardDescription>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">Weekly</Badge>
                <Badge variant="outline" className="text-[10px]">Monthly</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full rounded-lg border border-dashed border-[#2a2b31] bg-[#141416]/40 flex flex-col items-center justify-center gap-2 text-center p-6">
              <BarChart3 className="w-10 h-10 text-indigo-400/40" />
              <span className="text-xs font-semibold text-[#9ca3af]">
                Recharts Analytics Canvas Slot (col-span-8)
              </span>
              <span className="text-[11px] text-[#9ca3af]/60 max-w-sm">
                Ready for Phase 2+ hourly check-in volume and branch-wise compliance graphs
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Live Activity Feed Placeholder (col-span-12 lg:col-span-4) */}
        <Card className="col-span-12 lg:col-span-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Real-Time Check-In Stream</CardTitle>
                <CardDescription>Live Verification Slot</CardDescription>
              </div>
              <ArrowUpRight className="w-4 h-4 text-[#9ca3af]" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded-lg bg-[#141416] border border-[#2a2b31]/60"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <div className="space-y-1">
                    <div className="h-3 w-28 bg-[#2a2b31] rounded" />
                    <div className="h-2 w-16 bg-[#2a2b31]/60 rounded" />
                  </div>
                </div>
                <div className="h-4 w-12 bg-[#2a2b31]/40 rounded text-[10px]" />
              </div>
            ))}
          </CardContent>
        </Card>

      </div>

      {/* 12-Column Content Grid: Row 4 — Full-Width Data Grid Placeholder (col-span-12) */}
      <Card className="col-span-12">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">College Attendance Master Registry</CardTitle>
              <CardDescription>Full 12-Column Table / Data Grid Slot</CardDescription>
            </div>
            <Badge variant="outline" className="text-[11px]">8 Branches Active</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-44 w-full rounded-lg border border-dashed border-[#2a2b31] bg-[#141416]/40 flex flex-col items-center justify-center gap-2 text-center p-6">
            <Layers className="w-9 h-9 text-[#9ca3af]/40" />
            <span className="text-xs font-semibold text-[#9ca3af]">
              12-Column Master Register Placeholder Slot
            </span>
            <span className="text-[11px] text-[#9ca3af]/60 max-w-md">
              Configured for department sections, student SAP ID verification rosters, and Excel export grids
            </span>
          </div>
        </CardContent>
      </Card>

    </div>
  );
};
