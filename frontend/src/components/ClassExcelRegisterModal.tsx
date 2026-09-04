import React, { useState, useEffect } from 'react';
import { 
  X, FileSpreadsheet, Download, Search, Filter, RefreshCw, 
  CheckCircle, XCircle, AlertCircle, ArrowUpDown, Table
} from 'lucide-react';
import { apiRequest } from '../services/api';

interface SectionOption {
  id: number;
  name: string;
  department_name?: string;
}

interface MatrixRow {
  sno: number;
  student_id: number;
  roll_number: string;
  name: string;
  department: string;
  section: string;
  daily_status: Record<string, string>;
  total_sessions: number;
  present_count: number;
  absent_count: number;
  percentage: number;
}

interface ClassExcelRegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignedSections?: SectionOption[];
  defaultSectionId?: number;
}

export const ClassExcelRegisterModal: React.FC<ClassExcelRegisterModalProps> = ({
  isOpen,
  onClose,
  assignedSections = [],
  defaultSectionId
}) => {
  const [selectedSectionId, setSelectedSectionId] = useState<number | ''>(defaultSectionId || (assignedSections[0]?.id || ''));
  const [allSections, setAllSections] = useState<SectionOption[]>(assignedSections);
  const [dates, setDates] = useState<string[]>([]);
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'CRITICAL'>('ALL'); // CRITICAL = < 75%

  // Fetch sections list and auto-select default section
  useEffect(() => {
    if (!isOpen) return;

    if (defaultSectionId) {
      setSelectedSectionId(defaultSectionId);
    }

    if (assignedSections && assignedSections.length > 0) {
      setAllSections(assignedSections);
      if (!defaultSectionId && !selectedSectionId) {
        setSelectedSectionId(assignedSections[0].id);
      }
    } else {
      apiRequest<any[]>('/admin/sections')
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setAllSections(data);
            if (!defaultSectionId && !selectedSectionId) {
              setSelectedSectionId(data[0].id);
            }
          }
        })
        .catch(err => console.error("Error fetching sections:", err));
    }
  }, [isOpen, defaultSectionId, assignedSections?.length]);

  // Fetch Matrix Data when section changes
  useEffect(() => {
    if (isOpen) {
      fetchMatrixData();
    }
  }, [isOpen, selectedSectionId]);

  const fetchMatrixData = async () => {
    setLoading(true);
    try {
      const queryStr = selectedSectionId ? `?section_id=${selectedSectionId}` : '';
      const data: any = await apiRequest(`/reports/class-sheet-matrix${queryStr}`);
      setDates(data.dates || []);
      setRows(data.rows || []);
    } catch (err) {
      console.error("Failed to load class sheet matrix:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = async () => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    if (selectedSectionId) params.append('section_id', String(selectedSectionId));
    if (token) params.append('token', token);

    try {
      const response = await fetch(`/api/v1/reports/export/excel?${params.toString()}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error('Excel export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Class_Register_Section_${selectedSectionId || 'All'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export Excel register:', err);
    }
  };

  const handleExportCSV = async () => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    if (selectedSectionId) params.append('section_id', String(selectedSectionId));
    if (token) params.append('token', token);

    try {
      const response = await fetch(`/api/v1/reports/export/csv?${params.toString()}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error('CSV export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Class_Register_Section_${selectedSectionId || 'All'}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export CSV register:', err);
    }
  };

  if (!isOpen) return null;

  // Filtered rows
  const filteredRows = rows.filter(r => {
    const matchesSearch = r.roll_number.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          r.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterMode === 'ALL' ? true : r.percentage < 75.0;
    return matchesSearch && matchesFilter;
  });

  const totalClassPresent = rows.reduce((acc, r) => acc + r.present_count, 0);
  const totalPossible = rows.reduce((acc, r) => acc + r.total_sessions, 0);
  const classAvg = totalPossible > 0 ? (totalClassPresent / totalPossible * 100).toFixed(1) : '100.0';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white border border-slate-300 rounded-2xl shadow-2xl w-full max-w-7xl h-[92vh] flex flex-col overflow-hidden">
        
        {/* Light Theme Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-[#001e40] text-white border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
                Class Attendance Register <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-400/30">EXCEL GRID</span>
              </h2>
              <p className="text-xs text-blue-200 font-medium">Institutional day-by-day attendance register view (Period counts display)</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md"
            >
              <Download className="w-3.5 h-3.5" /> Excel (.xlsx)
            </button>
            <button
              onClick={handleExportCSV}
              className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition border border-white/20 ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Light Toolbar Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 border-b border-slate-200">
          
          {/* Class Select Dropdown */}
          <div className="flex items-center gap-2 min-w-[260px]">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider shrink-0">Class Section:</span>
            <select
              value={selectedSectionId}
              onChange={(e) => setSelectedSectionId(e.target.value ? Number(e.target.value) : '')}
              className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2f53d7] shadow-sm"
            >
              {allSections.map(sec => (
                <option key={sec.id} value={sec.id}>
                  {sec.department_name ? `${sec.department_name} - ${sec.name}` : sec.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search Roll No or Name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl pl-8 pr-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2f53d7] shadow-sm"
            />
          </div>

          {/* Shortage Toggle */}
          <div className="flex items-center gap-1.5 bg-slate-200/80 p-1 rounded-xl border border-slate-300">
            <button
              onClick={() => setFilterMode('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                filterMode === 'ALL' ? 'bg-[#2f53d7] text-white shadow-sm font-extrabold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({rows.length})
            </button>
            <button
              onClick={() => setFilterMode('CRITICAL')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                filterMode === 'CRITICAL' ? 'bg-rose-600 text-white font-extrabold shadow-sm' : 'text-rose-700 hover:text-rose-900'
              }`}
            >
              <AlertCircle className="w-3 h-3" /> Shortage &lt;75% ({rows.filter(r => r.percentage < 75).length})
            </button>
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchMatrixData}
            disabled={loading}
            className="p-2 bg-white hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-300 transition shadow-sm"
            title="Refresh Sheet Matrix"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#2f53d7]' : ''}`} />
          </button>
        </div>

        {/* Light Theme Register Table */}
        <div className="flex-1 overflow-auto bg-white relative">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-sm z-20">
              <RefreshCw className="w-8 h-8 text-[#2f53d7] animate-spin mb-2" />
              <p className="text-xs font-semibold text-slate-600">Loading Register Matrix...</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <Table className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-sm font-bold text-slate-700">No attendance records found</p>
              <p className="text-xs text-slate-500 mt-1">Select a class section or clear search filters</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs font-mono">
              {/* Light Table Header */}
              <thead className="bg-[#f0f4f9] sticky top-0 z-10 border-b-2 border-slate-300 text-slate-800 shadow-sm">
                <tr>
                  <th className="py-3 px-3 font-extrabold text-slate-700 bg-[#f0f4f9] border-r border-slate-300 text-center w-12 sticky left-0 z-20">S.No</th>
                  <th className="py-3 px-3 font-extrabold text-[#001e40] bg-[#f0f4f9] border-r border-slate-300 w-32 sticky left-12 z-20">Roll Number</th>
                  <th className="py-3 px-3 font-extrabold text-[#001e40] bg-[#f0f4f9] border-r border-slate-300 w-44">Student Name</th>
                  <th className="py-3 px-2 font-bold text-slate-600 border-r border-slate-300 text-center w-16">Dept</th>
                  <th className="py-3 px-2 font-bold text-slate-600 border-r border-slate-300 text-center w-16">Sec</th>

                  {/* Dates Columns */}
                  {dates.map(date => (
                    <th key={date} className="py-2 px-2 font-extrabold text-[#2f53d7] border-r border-slate-300 text-center min-w-[72px]">
                      <div className="text-[10px] text-slate-500 font-normal">{date.slice(0, 4)}</div>
                      <div>{date.slice(5)}</div>
                    </th>
                  ))}

                  <th className="py-3 px-3 font-extrabold text-emerald-700 border-r border-slate-300 text-center w-20">Present</th>
                  <th className="py-3 px-3 font-extrabold text-rose-700 border-r border-slate-300 text-center w-20">Absent</th>
                  <th className="py-3 px-3 font-extrabold text-[#001e40] text-center w-24">Percentage</th>
                </tr>
              </thead>

              {/* Light Table Body */}
              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredRows.map((r) => (
                  <tr key={r.student_id} className="hover:bg-blue-50/50 transition group">
                    <td className="py-2.5 px-3 text-center font-bold text-slate-500 bg-white group-hover:bg-blue-50/50 border-r border-slate-200 sticky left-0 z-10">{r.sno}</td>
                    <td className="py-2.5 px-3 font-bold font-mono text-[#2f53d7] bg-white group-hover:bg-blue-50/50 border-r border-slate-200 sticky left-12 z-10">{r.roll_number}</td>
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-800 border-r border-slate-200 truncate max-w-[180px]">{r.name}</td>
                    <td className="py-2.5 px-2 text-center text-slate-600 border-r border-slate-200 font-semibold">{r.department}</td>
                    <td className="py-2.5 px-2 text-center text-slate-600 border-r border-slate-200 font-semibold">{r.section}</td>

                    {/* Daily Status Cells: Display Period Counts (e.g. 4, 3, 2, 1) instead of P */}
                    {dates.map(date => {
                      const st = r.daily_status[date] || '-';
                      const isPresent = (st !== '-' && st !== 'A');
                      return (
                        <td key={date} className="py-2.5 px-2 text-center border-r border-slate-200 font-bold">
                          {isPresent ? (
                            <span className="inline-block w-6 h-6 leading-6 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold text-[12px] shadow-sm" title={`${st} Period(s) Present`}>
                              {st}
                            </span>
                          ) : st === 'A' ? (
                            <span className="inline-block w-6 h-6 leading-6 rounded-md bg-rose-100 text-rose-800 border border-rose-300 font-extrabold text-[12px] shadow-sm">
                              A
                            </span>
                          ) : (
                            <span className="text-slate-300 font-normal">-</span>
                          )}
                        </td>
                      );
                    })}

                    <td className="py-2.5 px-3 text-center font-extrabold text-emerald-700 border-r border-slate-200 bg-emerald-50/40">{r.present_count}</td>
                    <td className="py-2.5 px-3 text-center font-extrabold text-rose-700 border-r border-slate-200 bg-rose-50/40">{r.absent_count}</td>
                    <td className="py-2.5 px-3 text-center font-bold">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold ${
                        r.percentage >= 75 ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800 border border-rose-300'
                      }`}>
                        {r.percentage}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Light Footer Summary */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-600 font-sans">
          <div className="flex items-center gap-4">
            <span>Total Students: <strong className="text-slate-900 font-mono">{rows.length}</strong></span>
            <span>Active Dates: <strong className="text-[#2f53d7] font-mono">{dates.length}</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Class Average: <strong className="text-emerald-700 font-mono">{classAvg}%</strong>
            </span>
          </div>
        </div>

      </div>
    </div>
  );
};
