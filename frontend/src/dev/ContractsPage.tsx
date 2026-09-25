import React, { useState } from 'react';
import { api, ApiError } from '../core/api/client';
import { s } from '../core/api/schemas';
import type { ZodType } from 'zod';
import { CheckCircle2, XCircle, Play, RefreshCw, Layers, ShieldCheck, Database } from 'lucide-react';

interface ContractEndpoint {
  id: string;
  name: string;
  method: 'GET' | 'POST';
  path: string;
  schema: ZodType<unknown>;
  schemaName: string;
  isMock?: boolean;
}

interface RunResult {
  status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
  httpStatus?: number;
  keys?: string[];
  error?: string;
  latencyMs?: number;
}

const ENDPOINTS: ContractEndpoint[] = [
  {
    id: 'auth-me',
    name: 'Auth Current User',
    method: 'GET',
    path: '/api/v1/auth/me',
    schema: s.UserResponseSchema,
    schemaName: 'UserResponseSchema',
  },
  {
    id: 'admin-dashboard-stats',
    name: 'Admin Dashboard Stats',
    method: 'GET',
    path: '/api/v1/admin/dashboard-stats',
    schema: s.DashboardStatsSchema,
    schemaName: 'DashboardStatsSchema',
  },
  {
    id: 'admin-audit-logs',
    name: 'Admin Audit Logs',
    method: 'GET',
    path: '/api/v1/admin/audit-logs?limit=5',
    schema: s.AuditLogListSchema,
    schemaName: 'AuditLogListSchema',
  },
  {
    id: 'admin-students',
    name: 'Admin Students Directory',
    method: 'GET',
    path: '/api/v1/admin/students?page=1&page_size=3',
    schema: s.StudentListSchema,
    schemaName: 'StudentListSchema',
  },
  {
    id: 'admin-teachers',
    name: 'Admin Faculty Roster',
    method: 'GET',
    path: '/api/v1/admin/teachers',
    schema: s.TeacherListSchema,
    schemaName: 'TeacherListSchema',
  },
  {
    id: 'admin-departments',
    name: 'Admin Departments',
    method: 'GET',
    path: '/api/v1/admin/departments',
    schema: s.DepartmentListSchema,
    schemaName: 'DepartmentListSchema',
  },
  {
    id: 'admin-sections',
    name: 'Admin Sections',
    method: 'GET',
    path: '/api/v1/admin/sections',
    schema: s.SectionListSchema,
    schemaName: 'SectionListSchema',
  },
  {
    id: 'admin-subjects',
    name: 'Admin Subjects',
    method: 'GET',
    path: '/api/v1/admin/subjects',
    schema: s.SubjectListSchema,
    schemaName: 'SubjectListSchema',
  },
  {
    id: 'admin-years',
    name: 'Admin Academic Years',
    method: 'GET',
    path: '/api/v1/admin/years',
    schema: s.AcademicYearListSchema,
    schemaName: 'AcademicYearListSchema',
  },
  {
    id: 'admin-onboard-status',
    name: 'Admin Onboarding Status',
    method: 'GET',
    path: '/api/v1/admin/onboard/status?page=1&page_size=3',
    schema: s.OnboardingStatusResponseSchema,
    schemaName: 'OnboardingStatusResponseSchema',
  },
  {
    id: 'admin-rebind-requests',
    name: 'Admin Rebind Requests',
    method: 'GET',
    path: '/api/v1/admin/onboard/rebind-requests',
    schema: s.RebindRequestsListSchema,
    schemaName: 'RebindRequestsListSchema',
  },
  {
    id: 'telemetry-scanner-health',
    name: 'Telemetry Scanner Health',
    method: 'GET',
    path: '/api/v1/telemetry/scanner-health?timeframe_days=7',
    schema: s.ScannerHealthResponseSchema,
    schemaName: 'ScannerHealthResponseSchema',
  },
  {
    id: 'telemetry-summary',
    name: 'Telemetry Summary',
    method: 'GET',
    path: '/api/v1/telemetry/summary',
    schema: s.TelemetrySummaryResponseSchema,
    schemaName: 'TelemetrySummaryResponseSchema',
  },
  {
    id: 'reports-low-attendance',
    name: 'Reports Low Attendance',
    method: 'GET',
    path: '/api/v1/reports/low-attendance',
    schema: s.LowAttendanceListSchema,
    schemaName: 'LowAttendanceListSchema',
  },
  {
    id: 'reports-class-matrix',
    name: 'Reports Class Sheet Matrix',
    method: 'GET',
    path: '/api/v1/reports/class-sheet-matrix?section_id=35',
    schema: s.ClassSheetMatrixSchema,
    schemaName: 'ClassSheetMatrixSchema',
  },
  {
    id: 'devices-student-info',
    name: 'Devices Student Info',
    method: 'GET',
    path: '/api/v1/devices/student-device-info?roll_number=23311A0504',
    schema: s.StudentDeviceInfoSchema,
    schemaName: 'StudentDeviceInfoSchema',
  },
  {
    id: 'binding-status',
    name: 'Student Binding Status (Student Role)',
    method: 'GET',
    path: '/api/v1/binding/status',
    schema: s.BindingStatusSchema,
    schemaName: 'BindingStatusSchema',
  },
  {
    id: 'teacher-classes',
    name: 'Teacher Assigned Classes',
    method: 'GET',
    path: '/api/v1/teacher/assigned-classes',
    schema: s.TeacherAssignedClassesListSchema,
    schemaName: 'TeacherAssignedClassesListSchema',
  },
  {
    id: 'teacher-history',
    name: 'Teacher Historical Sessions',
    method: 'GET',
    path: '/api/v1/teacher/historical-sessions',
    schema: s.HistoricalSessionsListSchema,
    schemaName: 'HistoricalSessionsListSchema',
  },
  // Mock Gap Endpoints (labelled MOCK)
  {
    id: 'mock-overview-rollup',
    name: 'Mock Overview Rollup',
    method: 'GET',
    path: '/api/v1/admin/overview/rollup?range=today',
    schema: s.OverviewStatsRollupSchema,
    schemaName: 'OverviewStatsRollupSchema',
    isMock: true,
  },
  {
    id: 'mock-hourly-heatmap',
    name: 'Mock Hourly Heatmap',
    method: 'GET',
    path: '/api/v1/admin/overview/heatmap?range=today',
    schema: s.HourlyHeatmapSchema,
    schemaName: 'HourlyHeatmapSchema',
    isMock: true,
  },
  {
    id: 'mock-checkin-sources',
    name: 'Mock Check-In Sources',
    method: 'GET',
    path: '/api/v1/admin/overview/sources?range=today',
    schema: s.CheckInSourcesBreakdownSchema,
    schemaName: 'CheckInSourcesBreakdownSchema',
    isMock: true,
  },
  {
    id: 'mock-attendance-trends',
    name: 'Mock Attendance Trends',
    method: 'GET',
    path: '/api/v1/admin/overview/trends?range=week',
    schema: s.AttendanceTrendsRollupSchema,
    schemaName: 'AttendanceTrendsRollupSchema',
    isMock: true,
  },
];

export const ContractsPage: React.FC = () => {
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [isRunningAll, setIsRunningAll] = useState(false);

  const runEndpoint = async (ep: ContractEndpoint) => {
    setResults((prev) => ({
      ...prev,
      [ep.id]: { status: 'RUNNING' },
    }));

    const t0 = performance.now();
    try {
      const data = await api(ep.path, ep.schema);
      const dt = Math.round(performance.now() - t0);

      let keys: string[] = [];
      if (Array.isArray(data)) {
        keys = data.length > 0 && typeof data[0] === 'object' && data[0] !== null
          ? Object.keys(data[0] as object)
          : [`Array(${data.length})`];
      } else if (data && typeof data === 'object') {
        keys = Object.keys(data as object);
      }

      setResults((prev) => ({
        ...prev,
        [ep.id]: {
          status: 'PASS',
          httpStatus: 200,
          keys,
          latencyMs: dt,
        },
      }));
    } catch (err) {
      const dt = Math.round(performance.now() - t0);
      let httpStatus = 500;
      let errorMsg = 'Unknown error';

      if (err instanceof ApiError) {
        httpStatus = err.status;
        errorMsg = `HTTP ${err.status}: ${err.body.substring(0, 80)}`;
      } else if (err instanceof Error) {
        errorMsg = err.message;
      }

      setResults((prev) => ({
        ...prev,
        [ep.id]: {
          status: 'FAIL',
          httpStatus,
          error: errorMsg,
          latencyMs: dt,
        },
      }));
    }
  };

  const runAll = async () => {
    setIsRunningAll(true);
    for (const ep of ENDPOINTS) {
      await runEndpoint(ep);
    }
    setIsRunningAll(false);
  };

  const realEndpoints = ENDPOINTS.filter((e) => !e.isMock);
  const realResults = realEndpoints.map((e) => results[e.id]).filter(Boolean);
  const passCount = realResults.filter((r) => r.status === 'PASS').length;
  const failCount = realResults.filter((r) => r.status === 'FAIL').length;
  const totalRan = realResults.length;

  return (
    <div className="min-h-screen bg-[#141416] text-[#f8fafc] p-6 font-sans antialiased">
      {/* Top Header */}
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#2a2b31]">
          <div>
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-7 h-7 text-indigo-400" />
              <h1 className="text-2xl font-bold tracking-tight text-white">API Contracts & Parity Verification</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Phase 3 Parity Gate
              </span>
            </div>
            <p className="text-sm text-[#9ca3af] mt-1">
              Live Zod schema validation against the running FastAPI backend monolith.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={runAll}
              disabled={isRunningAll}
              className="px-4 py-2 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] hover:from-[#5558e6] hover:to-[#7c4deb] text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-500/25 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isRunningAll ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Running All ({totalRan}/{ENDPOINTS.length})...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>RUN ALL REAL ENDPOINTS</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Parity Summary Stats Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-[#1e1f24] border border-[#2a2b31] rounded-xl p-4 flex items-center gap-3">
            <Database className="w-5 h-5 text-indigo-400" />
            <div>
              <p className="text-xs text-[#9ca3af]">Total Real Endpoints</p>
              <p className="text-lg font-bold text-white">{realEndpoints.length}</p>
            </div>
          </div>
          <div className="bg-[#1e1f24] border border-[#2a2b31] rounded-xl p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <div>
              <p className="text-xs text-[#9ca3af]">Zod Validation PASS</p>
              <p className="text-lg font-bold text-emerald-400">{passCount}</p>
            </div>
          </div>
          <div className="bg-[#1e1f24] border border-[#2a2b31] rounded-xl p-4 flex items-center gap-3">
            <XCircle className="w-5 h-5 text-red-400" />
            <div>
              <p className="text-xs text-[#9ca3af]">Validation FAIL</p>
              <p className="text-lg font-bold text-red-400">{failCount}</p>
            </div>
          </div>
          <div className="bg-[#1e1f24] border border-[#2a2b31] rounded-xl p-4 flex items-center gap-3">
            <Layers className="w-5 h-5 text-amber-400" />
            <div>
              <p className="text-xs text-[#9ca3af]">Unbuilt Gap Mocks</p>
              <p className="text-lg font-bold text-amber-400">4 Gaps</p>
            </div>
          </div>
        </div>

        {/* Contracts Table */}
        <div className="bg-[#1e1f24] border border-[#2a2b31] rounded-2xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#f8fafc]">
              <thead className="bg-[#141416]/60 border-b border-[#2a2b31] uppercase tracking-wider text-[#9ca3af] font-semibold text-[11px]">
                <tr>
                  <th className="py-3.5 px-4">Endpoint</th>
                  <th className="py-3.5 px-3">Method</th>
                  <th className="py-3.5 px-4">Path</th>
                  <th className="py-3.5 px-4">Zod Schema</th>
                  <th className="py-3.5 px-3 text-center">Status</th>
                  <th className="py-3.5 px-4">Parsed Keys / Error</th>
                  <th className="py-3.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/60">
                {ENDPOINTS.map((ep) => {
                  const res = results[ep.id] || { status: 'IDLE' };
                  return (
                    <tr
                      key={ep.id}
                      className={`hover:bg-white/[0.02] transition-colors ${
                        ep.isMock ? 'bg-amber-500/[0.02]' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-semibold text-white whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{ep.name}</span>
                          {ep.isMock && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              MOCK
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {ep.method}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-mono text-[#9ca3af] max-w-xs truncate" title={ep.path}>
                        {ep.path}
                      </td>

                      <td className="py-3 px-4 font-mono text-violet-300/90 whitespace-nowrap">
                        {ep.schemaName}
                      </td>

                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {res.status === 'IDLE' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#2a2b31] text-[#9ca3af]">
                            IDLE
                          </span>
                        )}
                        {res.status === 'RUNNING' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 animate-pulse">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                            TESTING
                          </span>
                        )}
                        {res.status === 'PASS' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            PASS (200)
                          </span>
                        )}
                        {res.status === 'FAIL' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                            <XCircle className="w-3 h-3 text-red-400" />
                            FAIL ({res.httpStatus || 500})
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 max-w-md">
                        {res.status === 'PASS' && res.keys && (
                          <div className="flex flex-wrap gap-1">
                            {res.keys.slice(0, 8).map((k) => (
                              <span
                                key={k}
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/5 text-[#cbd5e1] border border-white/10"
                              >
                                {k}
                              </span>
                            ))}
                            {res.keys.length > 8 && (
                              <span className="text-[10px] text-[#9ca3af]">+{res.keys.length - 8} more</span>
                            )}
                            {res.latencyMs !== undefined && (
                              <span className="text-[10px] text-[#6b7280] ml-1">({res.latencyMs}ms)</span>
                            )}
                          </div>
                        )}
                        {res.status === 'FAIL' && (
                          <span className="text-red-400 font-mono text-[11px] truncate block" title={res.error}>
                            {res.error}
                          </span>
                        )}
                        {res.status === 'IDLE' && <span className="text-[#6b7280]">—</span>}
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => runEndpoint(ep)}
                          disabled={res.status === 'RUNNING'}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#2a2b31] hover:bg-[#32343c] text-white transition-colors disabled:opacity-50"
                        >
                          Run
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
