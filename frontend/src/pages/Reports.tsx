import React, { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { FileSpreadsheet, FileText, Download, AlertTriangle, Filter } from 'lucide-react';
import { Toast } from '../components/Toast';

export const Reports: React.FC = () => {
  const [lowAttendanceList, setLowAttendanceList] = useState<any[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchLowAttendance();
  }, []);

  const fetchLowAttendance = async () => {
    try {
      const data: any = await apiRequest('/reports/low-attendance?threshold=75');
      setLowAttendanceList(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleExport = async (format: 'excel' | 'csv' | 'pdf') => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (token) params.append('token', token);

    setToast({ message: `Generating ${format.toUpperCase()} report...`, type: 'success' });
    try {
      const url = `/api/v1/reports/export/${format}?${params.toString()}`;
      const response = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        throw new Error(`Export failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const ext = format === 'excel' ? 'xlsx' : format;
      a.download = `Attendance_Report_${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setToast({ message: `${format.toUpperCase()} report downloaded successfully!`, type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || `Failed to download ${format.toUpperCase()} report`, type: 'error' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Top Banner */}
      <div className="snist-card p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="px-3.5 py-1.5 bg-[#2f53d7]/10 text-[#2f53d7] border border-[#2f53d7]/20 rounded-full text-xs font-extrabold uppercase">
            Reports & Analytics
          </span>
          <h2 className="font-heading text-2xl sm:text-3xl font-extrabold text-[#15347e] mt-2">
            Attendance Registers & Exports
          </h2>
          <p className="text-sm font-medium text-[#6a7894]">
            Sreenidhi Institute of Science & Technology — Generate formatted Excel, CSV and PDF reports
          </p>
        </div>
      </div>

      {/* Export Options Card */}
      <div className="snist-card p-6 space-y-6">
        <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
          <Filter className="w-5 h-5 text-[#2f53d7]" /> Export Attendance Records
        </h3>

        {/* Date Range Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#17233c] mb-1.5">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="snist-input w-full text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#17233c] mb-1.5">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="snist-input w-full text-sm"
            />
          </div>
        </div>

        {/* Export Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <button
            onClick={() => handleExport('excel')}
            className="py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4" /> Download Excel (.xlsx)
          </button>

          <button
            onClick={() => handleExport('csv')}
            className="py-3 px-4 snist-btn-primary font-bold text-xs flex items-center justify-center gap-2"
          >
            <FileText className="w-4 h-4" /> Download CSV (.csv)
          </button>

          <button
            onClick={() => handleExport('pdf')}
            className="py-3 px-4 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            <Download className="w-4 h-4" /> Download PDF (.pdf)
          </button>
        </div>
      </div>

      {/* Low Attendance Alert Table (< 75%) */}
      <div className="snist-card p-6 border-rose-200 bg-rose-50/40 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-heading text-lg font-bold text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600" /> Low Attendance Alert List (&lt; 75%)
            </h3>
            <p className="text-xs font-medium text-rose-700">Students at risk of examination condonation or shortage</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">Roll Number</th>
                <th className="py-3 px-4">Student Name</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Section</th>
                <th className="py-3 px-4">Attended / Total</th>
                <th className="py-3 px-4">Attendance %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {lowAttendanceList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500 font-medium">No students currently below 75% threshold.</td>
                </tr>
              ) : (
                lowAttendanceList.map(item => (
                  <tr key={item.student_id} className="hover:bg-white">
                    <td className="py-3 px-4 font-mono font-bold text-rose-700">{item.roll_number}</td>
                    <td className="py-3 px-4 font-bold text-[#17233c]">{item.student_name}</td>
                    <td className="py-3 px-4 text-slate-700">{item.department}</td>
                    <td className="py-3 px-4 text-slate-700">{item.section}</td>
                    <td className="py-3 px-4 text-slate-700 font-mono">{item.attended} / {item.total_classes}</td>
                    <td className="py-3 px-4 font-bold text-rose-700 font-mono">{item.percentage}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
