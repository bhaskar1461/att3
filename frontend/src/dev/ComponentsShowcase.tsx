import React, { useState } from 'react';
import { DeltaPill } from '../components/dashboard/DeltaPill';
import { StatCard } from '../components/dashboard/StatCard';
import { ChartCard } from '../components/dashboard/ChartCard';
import { GradientHeroCard } from '../components/dashboard/GradientHeroCard';
import { DonutCard } from '../components/dashboard/DonutCard';
import { HeatmapTile } from '../components/dashboard/HeatmapTile';
import { ProgressBar } from '../components/dashboard/ProgressBar';
import { LegendSquare } from '../components/dashboard/LegendSquare';
import { SkeletonCard } from '../components/dashboard/SkeletonCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';

export const ComponentsShowcase: React.FC = () => {
  const [clickedSegment, setClickedSegment] = useState<string | null>(null);
  const [cardClicked, setCardClicked] = useState<string | null>(null);
  const [heatmapSelection, setHeatmapSelection] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  return (
    <div className="min-h-screen bg-[#141416] text-[#f8fafc] p-6 space-y-10 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-[#2a2b31]">
        <div>
          <Badge variant="hero" className="mb-2">Phase 2 Primitives</Badge>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            UI Primitives & Extensibility Showcase
          </h1>
          <p className="text-xs text-[#9ca3af] mt-1">
            Visual verification suite for all Phase 2 dashboard components.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsLoading(!isLoading)}
          >
            {isLoading ? 'Show Normal State' : 'Toggle Skeleton Loading'}
          </Button>
        </div>
      </div>

      {/* 1. DeltaPills & LegendSquares */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider">
          1. DeltaPill & LegendSquare Primitives
        </h2>
        <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-[#1e1f24] border border-[#2a2b31]">
          <DeltaPill value={12.4} loading={isLoading} />
          <DeltaPill value={-3.8} loading={isLoading} />
          <DeltaPill value={0} loading={isLoading} />
          <DeltaPill value={4.5} invert loading={isLoading} />
          <div className="h-6 w-[1px] bg-[#2a2b31]" />
          <LegendSquare color="#6366f1" label="Indigo Accent" />
          <LegendSquare color="#8b5cf6" label="Violet Accent" />
          <LegendSquare color="#10b981" label="Present (Green)" />
          <LegendSquare color="#ef4444" label="Absent (Red)" />
        </div>
      </section>

      {/* 2. StatCards */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider">
          2. StatCard Primitives (Interactive & Loading)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Students"
            value="3,450"
            delta={12.4}
            footer="Vs last month: +380"
            onClick={() => setCardClicked('Total Students clicked')}
            loading={isLoading}
          />
          <StatCard
            title="Present Today"
            value="3,120"
            delta={4.1}
            footer="SNIST campus wide: 90.4%"
            onClick={() => setCardClicked('Present Today clicked')}
            loading={isLoading}
          />
          <StatCard
            title="Unexcused Absences"
            value="142"
            delta={-2.4}
            invertDelta
            footer="Low attendance threshold alerts"
            onClick={() => setCardClicked('Absences clicked')}
            loading={isLoading}
          />
          <StatCard
            title="Biometric Verification"
            value="99.8%"
            delta={0.2}
            footer="Face AI match confidence"
            onClick={() => setCardClicked('Biometrics clicked')}
            loading={isLoading}
          />
        </div>
        {cardClicked && (
          <p className="text-xs text-indigo-400 font-mono">Feedback: {cardClicked}</p>
        )}
      </section>

      {/* 3. GradientHeroCard & DonutCard */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider">
          3. GradientHeroCard & DonutCard Primitives
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7">
            <GradientHeroCard
              title="Daily Attendance Velocity"
              gaugeValue={87}
              gaugeLabel="JNTUH R25"
              subStats={[
                { label: 'Verified Students', value: '3,120', color: '#ffffff' },
                { label: 'Active Faculty', value: '148', color: '#cbd5e1' },
                { label: '30-min Device Lockouts', value: '0', color: '#10b981' },
              ]}
              segments={[
                { label: 'On-Time', value: 80, color: '#ffffff' },
                { label: 'Late', value: 7, color: '#e2e8f0' },
                { label: 'Absent', value: 13, color: '#f87171' },
              ]}
              loading={isLoading}
            />
          </div>

          <div className="lg:col-span-5">
            <DonutCard
              title="Department Attendance Breakdown"
              centerValue="87.4%"
              centerLabel="Avg Match"
              segments={[
                { id: 'cse', label: 'Computer Science (CSE)', value: 1120, color: '#6366f1' },
                { id: 'it', label: 'Information Tech (IT)', value: 740, color: '#8b5cf6' },
                { id: 'ece', label: 'Electronics (ECE)', value: 680, color: '#a78bfa' },
                { id: 'mech', label: 'Mechanical (MECH)', value: 580, color: '#10b981' },
              ]}
              onSegmentClick={(id) => setClickedSegment(`Selected Dept: ${id}`)}
              progress={{ done: 3120, total: 3450, label: 'Verified Total Check-ins' }}
              loading={isLoading}
            />
            {clickedSegment && (
              <p className="text-xs text-indigo-400 font-mono mt-2">{clickedSegment}</p>
            )}
          </div>
        </div>
      </section>

      {/* 4. ChartCard & HeatmapTiles */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider">
          4. ChartCard, HeatmapTile & ProgressBar Primitives
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8">
            <ChartCard
              title="Hourly Attendance Waveform"
              subtitle="Live camera QR + face verifications per hour"
              toolbar={
                <div className="flex items-center gap-1 bg-[#141416] p-1 rounded-lg border border-[#2a2b31] text-xs">
                  <span className="px-2 py-0.5 rounded bg-[#1e1f24] text-white font-semibold">Today</span>
                  <span className="px-2 py-0.5 text-[#9ca3af] hover:text-white cursor-pointer">Week</span>
                </div>
              }
              loading={isLoading}
            >
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-[#141416] border border-[#2a2b31] text-xs text-[#9ca3af]">
                  Chart canvas body container ready for Recharts Line/Area charts in Phase 3.
                </div>
                <div>
                  <span className="text-xs text-[#9ca3af] mb-1.5 block">Department Progress Segment</span>
                  <ProgressBar
                    segments={[
                      { value: 55, color: '#6366f1', label: 'CSE' },
                      { value: 25, color: '#8b5cf6', label: 'ECE' },
                      { value: 15, color: '#10b981', label: 'MECH' },
                      { value: 5, color: '#ef4444', label: 'CIVIL' },
                    ]}
                    height={10}
                    loading={isLoading}
                  />
                </div>
              </div>
            </ChartCard>
          </div>

          <div className="lg:col-span-4">
            <ChartCard title="Session Density Heatmap" subtitle="Period 1 through 8 by department">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {[0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 1.0, 0.85, 0.5, 0.3, 0.95, 0.7].map((intensity, i) => (
                    <HeatmapTile
                      key={i}
                      intensity={intensity}
                      count={Math.round(intensity * 60)}
                      label={`Period ${i + 1} Hall B`}
                      onClick={() => setHeatmapSelection(`Period ${i + 1}: ${Math.round(intensity * 60)} check-ins`)}
                      loading={isLoading}
                    />
                  ))}
                </div>
                {heatmapSelection && (
                  <p className="text-xs text-indigo-400 font-mono">{heatmapSelection}</p>
                )}
              </div>
            </ChartCard>
          </div>
        </div>
      </section>

      {/* 5. SkeletonCard */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider">
          5. Standalone SkeletonCard
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
        </div>
      </section>
    </div>
  );
};

export default ComponentsShowcase;
