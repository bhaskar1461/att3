import React, { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { DashboardStats } from '../types';
import { Users, UserCheck, BarChart2, Shield, Settings, FileText, CheckCircle2, RefreshCw, Layers, FileSpreadsheet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ClassExcelRegisterModal } from '../components/ClassExcelRegisterModal';

export const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExcelRegisterOpen, setIsExcelRegisterOpen] = useState(false);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    try {
      const statsData: any = await apiRequest('/admin/dashboard-stats');
      setStats(statsData);
      const logsData: any = await apiRequest('/admin/audit-logs');
      setAuditLogs(logsData);
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

        <div className="flex items-center gap-3">
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

      {/* Metrics Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          
          <div className="snist-card p-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#6a7894] uppercase tracking-wider">Total Enrolled Students</span>
              <Users className="w-5 h-5 text-[#2f53d7]" />
            </div>
            <p className="font-heading text-3xl font-extrabold text-[#15347e]">{stats.total_students}</p>
            <span className="text-xs font-medium text-slate-500">Across {stats.total_departments} Departments</span>
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
      </div>

      {/* Class Register Excel Grid Modal */}
      <ClassExcelRegisterModal
        isOpen={isExcelRegisterOpen}
        onClose={() => setIsExcelRegisterOpen(false)}
      />

    </div>
  );
};
