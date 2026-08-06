import React, { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { Department, Section, Subject, Teacher, Student } from '../types';
import { UserPlus, FileSpreadsheet, Settings } from 'lucide-react';
import { Toast } from '../components/Toast';

export const Management: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'students' | 'teachers' | 'departments' | 'sections' | 'subjects' | 'settings'>('students');
  
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [years, setYears] = useState<any[]>([]);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Modal States
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // New Student Form
  const [newRoll, setNewRoll] = useState('');
  const [newName, setNewName] = useState('');
  const [newDeptId, setNewDeptId] = useState<number>(1);
  const [newYearId, setNewYearId] = useState<number>(1);
  const [newSecId, setNewSecId] = useState<number>(1);
  const [newEmail, setNewEmail] = useState('');

  // Import File Form
  const [importFile, setImportFile] = useState<File | null>(null);

  // Template Upload File
  const [templateFile, setTemplateFile] = useState<File | null>(null);

  // Settings State
  const [gsheetId, setGsheetId] = useState('');

  useEffect(() => {
    fetchAllManagementData();
  }, []);

  const fetchAllManagementData = async () => {
    setIsLoading(true);
    try {
      const [deptsData, secData, subData, teacherData, studentData, yearData, settingsData]: any = await Promise.all([
        apiRequest('/admin/departments'),
        apiRequest('/admin/sections'),
        apiRequest('/admin/subjects'),
        apiRequest('/admin/teachers'),
        apiRequest('/admin/students'),
        apiRequest('/admin/years'),
        apiRequest('/admin/settings'),
      ]);

      setDepartments(deptsData);
      setSections(secData);
      setSubjects(subData);
      setTeachers(teacherData);
      setStudents(studentData);
      setYears(yearData);
      if (settingsData.GOOGLE_SPREADSHEET_ID) {
        setGsheetId(settingsData.GOOGLE_SPREADSHEET_ID);
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Error loading data', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/admin/students', {
        method: 'POST',
        body: JSON.stringify({
          roll_number: newRoll,
          name: newName,
          department_id: newDeptId,
          academic_year_id: newYearId,
          section_id: newSecId,
          email: newEmail
        })
      });
      setToast({ message: `Student ${newRoll} created successfully`, type: 'success' });
      setIsStudentModalOpen(false);
      setNewRoll('');
      setNewName('');
      fetchAllManagementData();
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to create student', type: 'error' });
    }
  };

  const handleExcelImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('department_id', newDeptId.toString());
      formData.append('academic_year_id', newYearId.toString());
      formData.append('section_id', newSecId.toString());

      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/admin/students/import-excel', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      }).then(r => r.json());

      setToast({ message: `Import complete! ${res.imported} imported, ${res.skipped_duplicates} skipped`, type: 'success' });
      setIsImportModalOpen(false);
      setImportFile(null);
      fetchAllManagementData();
    } catch (err: any) {
      setToast({ message: err.message || 'Import failed', type: 'error' });
    }
  };

  const handleTemplateUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateFile) return;
    try {
      const formData = new FormData();
      formData.append('file', templateFile);

      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/admin/master-template/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      }).then(r => r.json());

      setToast({ message: res.message, type: 'success' });
      setTemplateFile(null);
    } catch (err: any) {
      setToast({ message: err.message || 'Upload failed', type: 'error' });
    }
  };

  const handleSaveSettings = async () => {
    try {
      await apiRequest('/admin/settings', {
        method: 'POST',
        body: JSON.stringify({
          settings: {
            GOOGLE_SPREADSHEET_ID: gsheetId
          }
        })
      });
      setToast({ message: 'Settings saved successfully', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Save failed', type: 'error' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="snist-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold text-[#15347e]">System Setup Hub</h2>
          <p className="text-xs font-medium text-[#6a7894]">Configure students, faculty, sections, master Excel templates & Google Sheets</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsStudentModalOpen(true)}
            className="px-3.5 py-2 snist-btn-primary text-xs font-bold flex items-center gap-1.5"
          >
            <UserPlus className="w-4 h-4" /> Add Student
          </button>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4" /> Bulk Excel Import
          </button>
        </div>
      </div>

      {/* Management Navigation Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto space-x-2 pb-1">
        {(['students', 'teachers', 'departments', 'sections', 'subjects', 'settings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === tab 
                ? 'bg-white text-[#15347e] border border-slate-300 shadow-sm'
                : 'text-slate-500 hover:text-[#15347e] hover:bg-white/60'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content Panels */}
      {activeTab === 'students' && (
        <div className="snist-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-lg font-bold text-[#15347e]">Registered Students ({students.length})</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-[#17233c] font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Roll Number</th>
                  <th className="py-3 px-4">Student Name</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Year</th>
                  <th className="py-3 px-4">Section</th>
                  <th className="py-3 px-4">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {students.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-bold text-[#2f53d7]">{s.roll_number}</td>
                    <td className="py-3 px-4 font-bold text-[#17233c]">{s.name}</td>
                    <td className="py-3 px-4 text-slate-700">{s.department}</td>
                    <td className="py-3 px-4 text-slate-700">{s.year}</td>
                    <td className="py-3 px-4 text-slate-700">{s.section}</td>
                    <td className="py-3 px-4 text-slate-500">{s.email || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'teachers' && (
        <div className="snist-card p-6 space-y-4">
          <h3 className="font-heading text-lg font-bold text-[#15347e]">Faculty Members ({teachers.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-[#17233c] font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Mobile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {teachers.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-bold text-[#2f53d7]">{t.teacher_code}</td>
                    <td className="py-3 px-4 font-bold text-[#17233c]">{t.name}</td>
                    <td className="py-3 px-4 text-slate-700">{t.department}</td>
                    <td className="py-3 px-4 text-slate-700">{t.username}</td>
                    <td className="py-3 px-4 text-slate-500">{t.mobile || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'departments' && (
        <div className="snist-card p-6 space-y-4">
          <h3 className="font-heading text-lg font-bold text-[#15347e]">College Departments</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {departments.map(d => (
              <div key={d.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-mono font-bold text-[#2f53d7]">{d.code}</span>
                <h4 className="font-heading text-base font-bold text-[#17233c] mt-1">{d.name}</h4>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'sections' && (
        <div className="snist-card p-6 space-y-4">
          <h3 className="font-heading text-lg font-bold text-[#15347e]">Sections</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {sections.map(sec => (
              <div key={sec.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <h4 className="font-heading text-base font-bold text-[#17233c]">{sec.name}</h4>
                <p className="text-xs text-slate-500 font-medium mt-1">{sec.department} • {sec.year}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'subjects' && (
        <div className="snist-card p-6 space-y-4">
          <h3 className="font-heading text-lg font-bold text-[#15347e]">Subjects</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {subjects.map(sub => (
              <div key={sub.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-mono font-bold text-[#2f53d7]">{sub.code}</span>
                <h4 className="font-heading text-base font-bold text-[#17233c] mt-1">{sub.name}</h4>
                <p className="text-xs text-slate-500 font-medium mt-1">{sub.department} • {sub.year}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-6">
          
          {/* Master Official Register Upload Card */}
          <div className="snist-card p-6 space-y-4">
            <div>
              <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" /> Master Official Attendance Register Template
              </h3>
              <p className="text-xs text-[#6a7894] mt-1">Upload official college attendance register (.xlsx) to preserve exact formatting, merged cells, fonts, and borders</p>
            </div>

            <form onSubmit={handleTemplateUpload} className="flex flex-col sm:flex-row items-center gap-3">
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
                className="snist-input w-full text-xs"
              />
              <button
                type="submit"
                disabled={!templateFile}
                className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-colors shrink-0 shadow-sm"
              >
                Upload Master Template
              </button>
            </form>
          </div>

          {/* Google Sheets Sync Settings */}
          <div className="snist-card p-6 space-y-4">
            <div>
              <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#2f53d7]" /> Google Sheets Real-Time Synchronization
              </h3>
              <p className="text-xs text-[#6a7894] mt-1">Enter target Google Sheets Spreadsheet ID for real-time live log appends</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#17233c] mb-1">Google Spreadsheet ID</label>
                <input
                  type="text"
                  value={gsheetId}
                  onChange={(e) => setGsheetId(e.target.value)}
                  placeholder="e.g. 1BxiMVs0XRra5nFMdACg_Yw6bC4A328N1-081"
                  className="snist-input w-full text-sm"
                />
              </div>

              <button
                onClick={handleSaveSettings}
                className="px-5 py-2.5 snist-btn-primary font-bold text-xs"
              >
                Save Settings
              </button>
            </div>
          </div>

        </div>
      )}

      {/* Add Student Modal */}
      {isStudentModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-heading text-lg font-bold text-[#15347e]">Add New Student</h3>

            <form onSubmit={handleCreateStudent} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#17233c] mb-1">Roll Number (Primary Key)</label>
                <input
                  type="text"
                  required
                  value={newRoll}
                  onChange={(e) => setNewRoll(e.target.value.toUpperCase())}
                  placeholder="e.g. 21311A0511"
                  className="snist-input w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#17233c] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Student Name"
                  className="snist-input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-[#17233c] mb-1">Department</label>
                  <select
                    value={newDeptId}
                    onChange={(e) => setNewDeptId(Number(e.target.value))}
                    className="snist-input w-full text-xs"
                  >
                    {departments.map(d => <option key={d.id} value={d.id}>{d.code}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#17233c] mb-1">Section</label>
                  <select
                    value={newSecId}
                    onChange={(e) => setNewSecId(Number(e.target.value))}
                    className="snist-input w-full text-xs"
                  >
                    {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsStudentModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 snist-btn-primary font-bold text-xs"
                >
                  Create Student
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-heading text-lg font-bold text-[#15347e]">Bulk Excel Student Import</h3>
            <p className="text-xs font-medium text-[#6a7894]">Select an Excel file containing Roll Number, Student Name, Email columns.</p>

            <form onSubmit={handleExcelImport} className="space-y-3">
              <input
                type="file"
                accept=".xlsx, .xls"
                required
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="snist-input w-full text-xs"
              />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-sm hover:bg-emerald-700"
                >
                  Start Import
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
