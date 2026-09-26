import React, { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { DashboardStats } from '../types';
import { Users, UserCheck, BarChart2, Shield, ShieldCheck, Settings, FileText, CheckCircle2, RefreshCw, Layers, FileSpreadsheet, ClipboardList, Mail, Smartphone, Activity } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClassExcelRegisterModal } from '../components/ClassExcelRegisterModal';
import { DepartmentEnrollmentModal } from '../components/admin/DepartmentEnrollmentModal';
import { OnboardingManager } from '../components/admin/OnboardingManager';
import { CredentialDispatcher } from '../components/admin/CredentialDispatcher';
import { DeviceManager } from '../components/admin/DeviceManager';
import { ComplianceTab } from '../components/admin/ComplianceTab';
import { ScannerHealthTab } from '../components/admin/ScannerHealthTab';

export const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExcelRegisterOpen, setIsExcelRegisterOpen] = useState(false);
  const [isEnrollmentModalOpen, setIsEnrollmentModalOpen] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const validTabs = ['dashboard', 'compliance', 'onboarding', 'credentials', 'devices', 'scanner_health'] as const;
  type TabType = typeof validTabs[number];
  const urlTab = searchParams.get('tab') as TabType | null;

  const [activeTab, setActiveTab] = useState<TabType>(
    urlTab && validTabs.includes(urlTab) ? urlTab : 'dashboard'
  );

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab') as TabType | null;
    if (tabFromUrl && validTabs.includes(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  };

  // Keyset / Offset Pagination State for Audit Logs
  const [auditPage, setAuditPage] = useState<number>(1);
  const [auditTotalPages, setAuditTotalPages] = useState<number>(1);
  const [auditTotal, setAuditTotal] = useState<number>(0);
  const [isLogsLoading, setIsLogsLoading] = useState<boolean>(false);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAuditLogs = async (page: number = 1) => {
    setIsLogsLoading(true);
    try {
      const logsData: any = await apiRequest(`/admin/audit-logs?page=${page}&limit=20`);
      if (logsData && logsData.items) {
        setAuditLogs(logsData.items);
        setAuditPage(logsData.page || page);
        setAuditTotalPages(logsData.total_pages || 1);
        setAuditTotal(logsData.total || 0);
      } else if (Array.isArray(logsData)) {
        setAuditLogs(logsData);
        setAuditTotal(logsData.length);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLogsLoading(false);
    }
  };

  const fetchAdminData = async () => {
    try {
      const statsData: any = await apiRequest('/admin/dashboard-stats');
      setStats(statsData);
      await fetchAuditLogs(1);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* SNIST Topbar Header Banner */}
      <div className="snist-card p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="px-3.5 py-1.5 bg-[#2f53d7]/10 text-[#2f53d7] border border-[#2f53d7]/20 rounded-full text-xs font-extrabold uppercase">
            Super Admin Portal
          </span>
          <h2 className="font-heading text-2xl sm:text-3xl font-extrabold text-[#15347e] mt-2">
            College Attendance Analytics
          </h2>
          <p className="text-sm font-medium text-[#6a7894] mt-0.5">
            Sreenidhi Institute of Science & Technology — Live Metrics & Master Excel Logs
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/admin"
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-md shadow-indigo-600/20 transition active:scale-95"
          >
            <BarChart2 className="w-4 h-4 text-indigo-200" /> Live Analytics Dashboard
          </Link>
          <button
            onClick={() => setIsExcelRegisterOpen(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-md shadow-emerald-600/20 transition active:scale-95"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-200" /> Class Registers (Excel Grid)
          </button>
          <Link
            to="/admin/management"
            className="px-4 py-2.5 snist-btn-primary text-xs font-bold flex items-center gap-2"
          >
            <Settings className="w-4 h-4" /> System Setup
          </Link>
          <button
            onClick={fetchAdminData}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors border border-slate-300"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 bg-white/60 p-1 rounded-2xl border border-slate-200 w-fit">
        {[
          { key: 'dashboard' as const, label: 'Dashboard', icon: BarChart2 },
          { key: 'scanner_health' as const, label: 'Scanner Health', icon: Activity },
          { key: 'compliance' as const, label: 'Compliance (JNTUH R25)', icon: ShieldCheck },
          { key: 'onboarding' as const, label: 'Onboarding', icon: ClipboardList },
          { key: 'credentials' as const, label: 'Credentials', icon: Mail },
          { key: 'devices' as const, label: 'Devices & Telemetry', icon: Smartphone },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all ${
                activeTab === tab.key
                  ? 'bg-[#2f53d7] text-white shadow-md shadow-[#2f53d7]/20'
                  : 'text-slate-500 hover:text-[#15347e] hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Scanner Health & Forensics Tab */}
      {activeTab === 'scanner_health' && (
        <ScannerHealthTab />
      )}

      {/* JNTUH R25 Compliance Tab */}
      {activeTab === 'compliance' && (
        <ComplianceTab onOpenDepartmentDrilldown={() => setIsEnrollmentModalOpen(true)} />
      )}

      {/* Devices & Telemetry Tab */}
      {activeTab === 'devices' && (
        <DeviceManager />
      )}

      {/* Onboarding Tab */}
      {activeTab === 'onboarding' && (
        <div className="snist-card p-6">
          <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2 mb-4">
            <ClipboardList className="w-5 h-5 text-[#2f53d7]" /> Student Onboarding Management
          </h3>
          <OnboardingManager />
        </div>
      )}

      {/* Credentials Tab */}
      {activeTab === 'credentials' && (
        <div className="snist-card p-6">
          <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5 text-[#2f53d7]" /> Credential Email Dispatch
          </h3>
          <CredentialDispatcher />
        </div>
      )}

      {/* Dashboard Tab Content */}
      {activeTab === 'dashboard' && (<>

      {/* Metrics Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          
          <div 
            onClick={() => setIsEnrollmentModalOpen(true)}
            className="snist-card p-6 space-y-2 cursor-pointer group hover:border-[#2f53d7] hover:shadow-md transition-all relative overflow-hidden"
            title="Click to view interactive department hierarchy & enrollment drill-down"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#6a7894] group-hover:text-[#2f53d7] uppercase tracking-wider transition-colors flex items-center gap-1.5">
                Total Enrolled Students
                <span className="text-[10px] lowercase font-semibold text-slate-400 group-hover:text-[#2f53d7]">(drill down &rarr;)</span>
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#2f53d7]/10 group-hover:bg-[#2f53d7] flex items-center justify-center transition-colors">
                <Users className="w-4 h-4 text-[#2f53d7] group-hover:text-white transition-colors" />
              </div>
            </div>
            <p className="font-heading text-3xl font-extrabold text-[#15347e] group-hover:text-[#2f53d7] transition-colors">{stats.total_students}</p>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-500">Across {stats.total_departments} Departments</span>
              <span className="text-[11px] font-bold text-[#2f53d7] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                View Diagram &rarr;
              </span>
            </div>
          </div>

          <div className="snist-card p-6 space-y-2 border-emerald-200 bg-emerald-50/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Present Today</span>
              <UserCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <p className="font-heading text-3xl font-extrabold text-emerald-700">{stats.present_today}</p>
            <span className="text-xs font-bold text-emerald-600">Absent: {stats.absent_today}</span>
          </div>

          <div className="snist-card p-6 space-y-2 border-blue-200 bg-blue-50/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#2f53d7] uppercase tracking-wider">Today's Attendance %</span>
              <BarChart2 className="w-5 h-5 text-[#2f53d7]" />
            </div>
            <p className="font-heading text-3xl font-extrabold text-[#15347e]">{stats.attendance_percentage}%</p>
            <span className="text-xs font-bold text-[#2f53d7]">SNIST Average</span>
          </div>

          <div className="snist-card p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#6a7894] uppercase tracking-wider">Active Live Classes</span>
              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
            </div>
            <p className="font-heading text-3xl font-extrabold text-[#15347e]">{stats.active_live_classes}</p>
            <span className="text-xs font-medium text-slate-500">Faculty Scanners Active</span>
          </div>

        </div>
      )}

      {/* Quick Action Navigation Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        <Link 
          to="/admin/management"
          className="snist-card snist-card-hover p-6 flex flex-col justify-between group"
        >
          <div>
            <div className="w-12 h-12 rounded-2xl bg-[#2f53d7]/10 border border-[#2f53d7]/20 flex items-center justify-center text-[#2f53d7] mb-4 group-hover:scale-110 transition-transform">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="font-heading text-lg font-bold text-[#15347e]">Student & Faculty Setup</h3>
            <p className="text-xs font-medium text-[#6a7894] mt-1">Manage Departments, Sections, Subjects, Faculty & bulk Excel student import</p>
          </div>
          <span className="mt-4 text-xs font-extrabold text-[#2f53d7] flex items-center gap-1 group-hover:translate-x-1 transition-transform">
            Open System Setup Hub →
          </span>
        </Link>

        <Link 
          to="/reports"
          className="snist-card snist-card-hover p-6 flex flex-col justify-between group"
        >
          <div>
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600 mb-4 group-hover:scale-110 transition-transform">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="font-heading text-lg font-bold text-[#15347e]">Reports & Exports</h3>
            <p className="text-xs font-medium text-[#6a7894] mt-1">Export attendance logs in Excel (.xlsx), CSV, and PDF format. View low attendance alerts (&lt; 75%)</p>
          </div>
          <span className="mt-4 text-xs font-extrabold text-indigo-600 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
            Generate Reports →
          </span>
        </Link>

        <div className="snist-card p-6 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 mb-4">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="font-heading text-lg font-bold text-[#15347e]">Master Excel Register</h3>
            <p className="text-xs font-medium text-[#6a7894] mt-1">Official master register template active: preserving formatting, fonts, borders & merged headers</p>
          </div>
          <span className="mt-4 text-xs font-extrabold text-emerald-700">Master Template Active</span>
        </div>

      </div>

      {/* System Audit Logs */}
      <div className="snist-card p-6 space-y-4">
        <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#2f53d7]" /> Recent System Audit Activity
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-[#17233c] font-bold uppercase border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Details</th>
                <th className="py-3 px-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">No recent audit activity.</td>
                </tr>
              ) : (
                auditLogs.map(l => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-[#17233c]">{l.username}</td>
                    <td className="py-3 px-4 text-[#2f53d7] font-mono font-semibold">{l.action}</td>
                    <td className="py-3 px-4 text-slate-600">{l.details || '-'}</td>
                    <td className="py-3 px-4 text-slate-500 font-mono">{l.timestamp}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Numbered Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-500 border-t border-slate-100">
          <div>
            Showing page <span className="font-bold text-[#17233c]">{auditPage}</span> of <span className="font-bold text-[#17233c]">{auditTotalPages}</span> ({auditTotal} total events)
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fetchAuditLogs(auditPage - 1)}
              disabled={auditPage <= 1 || isLogsLoading}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(5, auditTotalPages) }, (_, i) => {
              let p = i + 1;
              if (auditTotalPages > 5) {
                p = Math.max(1, Math.min(auditTotalPages - 4, auditPage - 2)) + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => fetchAuditLogs(p)}
                  disabled={isLogsLoading}
                  className={`w-8 h-8 rounded-lg font-bold text-xs transition ${
                    auditPage === p
                      ? 'bg-[#2f53d7] text-white shadow-sm'
                      : 'border border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => fetchAuditLogs(auditPage + 1)}
              disabled={auditPage >= auditTotalPages || isLogsLoading}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <ClassExcelRegisterModal
        isOpen={isExcelRegisterOpen}
        onClose={() => setIsExcelRegisterOpen(false)}
      />

      <DepartmentEnrollmentModal
        isOpen={isEnrollmentModalOpen}
        onClose={() => setIsEnrollmentModalOpen(false)}
      />

      </>)}{/* end dashboard tab */}

    </div>
  );
};
