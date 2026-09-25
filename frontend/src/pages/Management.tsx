import React, { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { Department, Section, Subject, Teacher, Student, AdminClassAssignment } from '../types';
import { 
  UserPlus, FileSpreadsheet, Settings, ExternalLink, Edit, 
  Download, Upload, RefreshCw, Trash2, Plus, Check, Search, 
  Filter, BookOpen, Layers, Users, ChevronRight, X, AlertCircle, Loader2
} from 'lucide-react';
import { Toast } from '../components/Toast';

export const Management: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'students' | 'teachers' | 'assignments' | 'departments' | 'sections' | 'subjects' | 'settings'>('students');
  
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<AdminClassAssignment[]>([]);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Modal States
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [teacherGSheetInput, setTeacherGSheetInput] = useState('');

  // Class Assignment & Register States
  const [isAssignmentsLoading, setIsAssignmentsLoading] = useState(false);
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [filterTeacherId, setFilterTeacherId] = useState<number | ''>('');
  const [filterSectionId, setFilterSectionId] = useState<number | ''>('');

  // Assign Class Modal
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignTeacherId, setAssignTeacherId] = useState<number | ''>('');
  const [assignSubjectId, setAssignSubjectId] = useState<number | ''>('');
  const [assignSectionId, setAssignSectionId] = useState<number | ''>('');
  const [assignGSheetId, setAssignGSheetId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // Upload Custom Register Modal
  const [isUploadRegisterModalOpen, setIsUploadRegisterModalOpen] = useState(false);
  const [selectedAssignmentForUpload, setSelectedAssignmentForUpload] = useState<AdminClassAssignment | null>(null);
  const [uploadRegisterFile, setUploadRegisterFile] = useState<File | null>(null);
  const [isUploadingRegister, setIsUploadingRegister] = useState(false);

  // Class Google Sheet Modal
  const [editingAssignmentGSheet, setEditingAssignmentGSheet] = useState<AdminClassAssignment | null>(null);
  const [assignmentGSheetInput, setAssignmentGSheetInput] = useState('');
  const [isSyncingRoster, setIsSyncingRoster] = useState(false);
  const [isFormattingSheet, setIsFormattingSheet] = useState(false);

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

  // Pagination States for Students
  const [studentPage, setStudentPage] = useState<number>(1);
  const [studentTotalPages, setStudentTotalPages] = useState<number>(1);
  const [studentTotal, setStudentTotal] = useState<number>(0);
  const [isStudentsLoading, setIsStudentsLoading] = useState<boolean>(false);

  // Pagination States for Teachers
  const [teacherPage, setTeacherPage] = useState<number>(1);
  const [teacherTotalPages, setTeacherTotalPages] = useState<number>(1);
  const [teacherTotal, setTeacherTotal] = useState<number>(0);
  const [isTeachersLoading, setIsTeachersLoading] = useState<boolean>(false);

  useEffect(() => {
    fetchAllManagementData();
  }, []);

  const fetchStudents = async (page: number = 1) => {
    setIsStudentsLoading(true);
    try {
      const res: any = await apiRequest(`/admin/students?page=${page}&page_size=20`);
      if (res && res.items) {
        setStudents(res.items);
        setStudentPage(res.page || page);
        setStudentTotalPages(res.total_pages || 1);
        setStudentTotal(res.total || 0);
      } else if (Array.isArray(res)) {
        setStudents(res);
        setStudentTotal(res.length);
      }
    } catch (err: any) {
      console.error("Failed to load students:", err);
    } finally {
      setIsStudentsLoading(false);
    }
  };

  const fetchTeachers = async (page: number = 1) => {
    setIsTeachersLoading(true);
    try {
      const res: any = await apiRequest(`/admin/teachers?page=${page}&page_size=20`);
      if (res && res.items) {
        setTeachers(res.items);
        setTeacherPage(res.page || page);
        setTeacherTotalPages(res.total_pages || 1);
        setTeacherTotal(res.total || 0);
      } else if (Array.isArray(res)) {
        setTeachers(res);
        setTeacherTotal(res.length);
      }
    } catch (err: any) {
      console.error("Failed to load teachers:", err);
    } finally {
      setIsTeachersLoading(false);
    }
  };

  const fetchAssignments = async () => {
    setIsAssignmentsLoading(true);
    try {
      const data: any = await apiRequest('/admin/assignments');
      setAssignments(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error("Failed to load assignments:", err);
    } finally {
      setIsAssignmentsLoading(false);
    }
  };

  const fetchAllManagementData = async () => {
    setIsLoading(true);
    try {
      const [deptsData, secData, subData, yearData, settingsData]: any = await Promise.all([
        apiRequest('/admin/departments'),
        apiRequest('/admin/sections'),
        apiRequest('/admin/subjects'),
        apiRequest('/admin/years'),
        apiRequest('/admin/settings'),
      ]);

      setDepartments(deptsData);
      setSections(secData);
      setSubjects(subData);
      setYears(yearData);
      if (settingsData && settingsData.GOOGLE_SPREADSHEET_ID) {
        setGsheetId(settingsData.GOOGLE_SPREADSHEET_ID);
      }
      await Promise.all([
        fetchStudents(1),
        fetchTeachers(1),
        fetchAssignments()
      ]);
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

      const res: any = await apiRequest('/admin/students/import-excel', {
        method: 'POST',
        body: formData
      });
      setToast({ message: res.message || 'Students imported successfully', type: 'success' });
      setIsImportModalOpen(false);
      setImportFile(null);
      fetchAllManagementData();
    } catch (err: any) {
      setToast({ message: err.message || 'Excel import failed', type: 'error' });
    }
  };

  const handleTemplateUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateFile) return;
    try {
      const formData = new FormData();
      formData.append('file', templateFile);

      const res: any = await apiRequest('/admin/settings/upload-master-template', {
        method: 'POST',
        body: formData
      });
      setToast({ message: res.message || 'Master template updated successfully', type: 'success' });
      setTemplateFile(null);
    } catch (err: any) {
      setToast({ message: err.message || 'Template upload failed', type: 'error' });
    }
  };

  const handleSaveTeacherGSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacher) return;
    try {
      const res: any = await apiRequest(`/admin/teachers/${editingTeacher.id}/google-sheet`, {
        method: 'PUT',
        body: JSON.stringify({ google_sheet_id: teacherGSheetInput })
      });
      setToast({ message: res.message || 'Updated teacher Google Sheet', type: 'success' });
      setEditingTeacher(null);
      fetchAllManagementData();
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update Google Sheet', type: 'error' });
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

  // Class Assignment Handlers
  const handleAssignClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTeacherId || !assignSubjectId || !assignSectionId) {
      setToast({ message: 'Please select faculty, subject, and section', type: 'error' });
      return;
    }
    setIsAssigning(true);
    try {
      const res: any = await apiRequest('/admin/assignments', {
        method: 'POST',
        body: JSON.stringify({
          teacher_id: Number(assignTeacherId),
          subject_id: Number(assignSubjectId),
          section_id: Number(assignSectionId),
          google_sheet_id: assignGSheetId.trim() || undefined
        })
      });
      setToast({ message: res.message || 'Class assigned with dedicated Excel register!', type: 'success' });
      setIsAssignModalOpen(false);
      setAssignGSheetId('');
      fetchAssignments();
      fetchTeachers(teacherPage);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to assign class', type: 'error' });
    } finally {
      setIsAssigning(false);
    }
  };

  const handleDownloadRegister = async (assignmentId: number, preferredName?: string) => {
    const token = localStorage.getItem('token');
    try {
      setToast({ message: 'Generating and downloading official class attendance register...', type: 'success' });
      const url = `/api/v1/admin/assignments/${assignmentId}/download-register`;
      const response = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = preferredName || `Register_${assignmentId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setToast({ message: `Downloaded register successfully!`, type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to download class register', type: 'error' });
    }
  };

  const handleUploadCustomRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignmentForUpload || !uploadRegisterFile) return;
    setIsUploadingRegister(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadRegisterFile);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/admin/assignments/${selectedAssignmentForUpload.id}/upload-register`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Upload failed with status ${response.status}`);
      }
      setToast({ message: 'Custom class attendance register uploaded successfully!', type: 'success' });
      setIsUploadRegisterModalOpen(false);
      setSelectedAssignmentForUpload(null);
      setUploadRegisterFile(null);
      fetchAssignments();
      fetchTeachers(teacherPage);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to upload custom register', type: 'error' });
    } finally {
      setIsUploadingRegister(false);
    }
  };

  const handleRegenerateRegister = async (assignmentId: number) => {
    try {
      setToast({ message: 'Regenerating class attendance register...', type: 'success' });
      const res: any = await apiRequest(`/admin/assignments/${assignmentId}/regenerate-register`, {
        method: 'POST'
      });
      setToast({ message: res.message || 'Register regenerated successfully', type: 'success' });
      fetchAssignments();
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to regenerate register', type: 'error' });
    }
  };

  const handleDeleteAssignment = async (assignmentId: number, classDesc: string) => {
    if (!window.confirm(`Are you sure you want to remove assignment for ${classDesc}?`)) return;
    try {
      const res: any = await apiRequest(`/admin/assignments/${assignmentId}`, {
        method: 'DELETE'
      });
      setToast({ message: res.message || 'Assignment removed successfully', type: 'success' });
      fetchAssignments();
      fetchTeachers(teacherPage);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to remove assignment', type: 'error' });
    }
  };

  const handleSaveAssignmentGSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAssignmentGSheet) return;
    try {
      const trimmed = assignmentGSheetInput.trim();
      const res: any = await apiRequest(`/admin/assignments/${editingAssignmentGSheet.id}/google-sheet`, {
        method: 'PUT',
        body: JSON.stringify({ google_sheet_id: trimmed || null })
      });
      setToast({ message: res.message || 'Updated class Google Sheet', type: 'success' });
      setEditingAssignmentGSheet(null);
      fetchAssignments();
      fetchTeachers(teacherPage);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update Google Sheet', type: 'error' });
    }
  };

  const handleClearAssignmentGSheet = async () => {
    if (!editingAssignmentGSheet) return;
    try {
      const res: any = await apiRequest(`/admin/assignments/${editingAssignmentGSheet.id}/google-sheet`, {
        method: 'PUT',
        body: JSON.stringify({ google_sheet_id: null })
      });
      setToast({ message: res.message || 'Class Google Sheet unlinked (reverted to faculty default)', type: 'success' });
      setEditingAssignmentGSheet(null);
      fetchAssignments();
      fetchTeachers(teacherPage);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to unlink Google Sheet', type: 'error' });
    }
  };

  const handleSyncAssignmentRoster = async () => {
    if (!editingAssignmentGSheet) return;
    const currentSheetId = assignmentGSheetInput.trim() || editingAssignmentGSheet.google_sheet_id;
    if (!currentSheetId) {
      setToast({ message: 'Please provide or save a Google Sheet ID / URL first', type: 'error' });
      return;
    }
    setIsSyncingRoster(true);
    try {
      const res: any = await apiRequest(`/admin/assignments/${editingAssignmentGSheet.id}/sync-roster-from-sheet`, {
        method: 'POST',
        body: JSON.stringify({ google_sheet_id: currentSheetId })
      });
      setToast({ message: res.message || 'Successfully synced student roster from Google Sheet!', type: 'success' });
      fetchAssignments();
      fetchStudents(studentPage);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to sync roster from Google Sheet', type: 'error' });
    } finally {
      setIsSyncingRoster(false);
    }
  };

  const handleFormatAssignmentSheet = async () => {
    if (!editingAssignmentGSheet) return;
    const currentSheetId = assignmentGSheetInput.trim() || editingAssignmentGSheet.google_sheet_id;
    if (!currentSheetId) {
      setToast({ message: 'Please provide or save a Google Sheet ID / URL first', type: 'error' });
      return;
    }
    setIsFormattingSheet(true);
    try {
      const res: any = await apiRequest(`/admin/assignments/${editingAssignmentGSheet.id}/format-sheet`, {
        method: 'POST',
        body: JSON.stringify({ google_sheet_id: currentSheetId })
      });
      setToast({ message: res.message || 'Successfully formatted Google Sheet with SNIST register template!', type: 'success' });
      fetchAssignments();
      fetchTeachers(teacherPage);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to format Google Sheet', type: 'error' });
    } finally {
      setIsFormattingSheet(false);
    }
  };

  // Filtered class assignments
  const filteredAssignments = assignments.filter(a => {
    if (filterTeacherId && a.teacher_id !== filterTeacherId) return false;
    if (filterSectionId && a.section_id !== filterSectionId) return false;
    if (assignmentSearch.trim()) {
      const q = assignmentSearch.toLowerCase();
      const matchTeacher = (a.teacher_name || '').toLowerCase().includes(q) || (a.teacher_code || '').toLowerCase().includes(q);
      const matchSubject = (a.subject_name || '').toLowerCase().includes(q) || (a.subject_code || '').toLowerCase().includes(q);
      const matchSection = (a.section_name || '').toLowerCase().includes(q);
      if (!matchTeacher && !matchSubject && !matchSection) return false;
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="snist-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-bold text-[#15347e]">System Setup Hub</h2>
          <p className="text-xs font-medium text-[#6a7894]">Configure students, faculty, multiple class assignments & dedicated Excel registers</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setAssignTeacherId('');
              setAssignSubjectId('');
              setAssignSectionId('');
              setAssignGSheetId('');
              setIsAssignModalOpen(true);
            }}
            className="px-3.5 py-2 bg-[#2f53d7] hover:bg-[#15347e] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> Assign Class
          </button>

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
        {[
          { id: 'students', label: 'Students' },
          { id: 'teachers', label: 'Teachers' },
          { id: 'assignments', label: 'Classes & Registers' },
          { id: 'departments', label: 'Departments' },
          { id: 'sections', label: 'Sections' },
          { id: 'subjects', label: 'Subjects' },
          { id: 'settings', label: 'Settings' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === tab.id 
                ? 'bg-white text-[#15347e] border border-slate-300 shadow-sm'
                : 'text-slate-500 hover:text-[#15347e] hover:bg-white/60'
            }`}
          >
            {tab.id === 'assignments' && <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />}
            {tab.label}
            {tab.id === 'assignments' && assignments.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 text-[10px] font-extrabold">
                {assignments.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content Panels */}
      {activeTab === 'students' && (
        <div className="snist-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-lg font-bold text-[#15347e]">Registered Students ({studentTotal})</h3>
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

          {/* Numbered Pagination Controls for Students */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-500 border-t border-slate-100">
            <div>
              Showing page <span className="font-bold text-[#17233c]">{studentPage}</span> of <span className="font-bold text-[#17233c]">{studentTotalPages}</span> ({studentTotal} total students)
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fetchStudents(studentPage - 1)}
                disabled={studentPage <= 1 || isStudentsLoading}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
              >
                Previous
              </button>
              {Array.from({ length: Math.min(5, studentTotalPages) }, (_, i) => {
                let p = i + 1;
                if (studentTotalPages > 5) {
                  p = Math.max(1, Math.min(studentTotalPages - 4, studentPage - 2)) + i;
                }
                return (
                  <button
                    key={p}
                    onClick={() => fetchStudents(p)}
                    disabled={isStudentsLoading}
                    className={`w-8 h-8 rounded-lg font-bold text-xs transition ${
                      studentPage === p
                        ? 'bg-[#2f53d7] text-white shadow-sm'
                        : 'border border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => fetchStudents(studentPage + 1)}
                disabled={studentPage >= studentTotalPages || isStudentsLoading}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Teachers Tab */}
      {activeTab === 'teachers' && (
        <div className="snist-card p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-heading text-lg font-bold text-[#15347e]">Faculty Members ({teacherTotal})</h3>
              <p className="text-xs text-[#6a7894]">Faculty can be assigned multiple classes. Each assigned class maintains a dedicated Excel register.</p>
            </div>
            <button
              onClick={() => {
                setAssignTeacherId('');
                setAssignSubjectId('');
                setAssignSectionId('');
                setAssignGSheetId('');
                setIsAssignModalOpen(true);
              }}
              className="px-3.5 py-1.5 bg-[#2f53d7] hover:bg-[#15347e] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors self-start sm:self-auto shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" /> Assign Class to Faculty
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-[#17233c] font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Faculty Name</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Assigned Classes & Live Registers</th>
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Individual Google Sheet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {teachers.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-bold text-[#2f53d7]">{t.teacher_code}</td>
                    <td className="py-3 px-4 font-bold text-[#17233c]">{t.name}</td>
                    <td className="py-3 px-4 text-slate-700">{t.department}</td>
                    
                    {/* Assigned Classes Column with Quick Register Download */}
                    <td className="py-3 px-4">
                      {t.assigned_classes && t.assigned_classes.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {t.assigned_classes.map((cls: any) => (
                            <div 
                              key={cls.id} 
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 border border-blue-200 text-[#15347e] rounded-md font-semibold text-[11px]"
                            >
                              <span>{cls.section_name} ({cls.subject_code})</span>
                              {cls.google_sheet_id ? (
                                <button
                                  onClick={() => {
                                    setEditingAssignmentGSheet({
                                      id: cls.id,
                                      teacher_name: t.name,
                                      teacher_id: t.id,
                                      teacher_code: t.teacher_code,
                                      subject_name: cls.subject_name || cls.subject_code,
                                      subject_code: cls.subject_code,
                                      section_name: cls.section_name,
                                      student_count: 0,
                                      google_sheet_id: cls.google_sheet_id,
                                      google_sheet_url: cls.google_sheet_url
                                    } as any);
                                    setAssignmentGSheetInput(cls.google_sheet_id || '');
                                  }}
                                  title={`Dedicated Class Sheet: ${cls.google_sheet_id}. Click to configure or sync.`}
                                  className="text-emerald-600 hover:text-emerald-800 p-0.5 rounded hover:bg-emerald-100 transition-colors flex items-center"
                                >
                                  <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingAssignmentGSheet({
                                      id: cls.id,
                                      teacher_name: t.name,
                                      teacher_id: t.id,
                                      teacher_code: t.teacher_code,
                                      subject_name: cls.subject_name || cls.subject_code,
                                      subject_code: cls.subject_code,
                                      section_name: cls.section_name,
                                      student_count: 0,
                                      google_sheet_id: ''
                                    } as any);
                                    setAssignmentGSheetInput('');
                                  }}
                                  title="Link dedicated Google Sheet for this class"
                                  className="text-slate-400 hover:text-blue-600 p-0.5 rounded hover:bg-blue-100 transition-colors flex items-center"
                                >
                                  <FileSpreadsheet className="w-3 h-3 opacity-40 hover:opacity-100" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDownloadRegister(cls.id, cls.excel_file_name)}
                                title={`Download Live Register: ${cls.excel_file_name}`}
                                className="text-emerald-700 hover:text-emerald-900 p-0.5 rounded hover:bg-emerald-100 transition-colors"
                              >
                                <Download className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              setFilterTeacherId(t.id);
                              setActiveTab('assignments');
                            }}
                            className="text-[10px] font-bold text-[#2f53d7] hover:underline ml-1"
                            title="Manage registers in Classes & Registers tab"
                          >
                            Manage ({t.assigned_count}) →
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <span className="italic text-[11px]">No classes assigned</span>
                          <button
                            onClick={() => {
                              setAssignTeacherId(t.id);
                              setAssignSubjectId('');
                              setAssignSectionId('');
                              setAssignGSheetId('');
                              setIsAssignModalOpen(true);
                            }}
                            className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-[#2f53d7] rounded text-[10px] font-bold border border-blue-200 transition"
                          >
                            + Assign
                          </button>
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-slate-700">{t.username}</td>
                    <td className="py-3 px-4">
                      {t.google_sheet_id ? (
                        <div className="flex items-center gap-1.5">
                          <a
                            href={t.google_sheet_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[#2f53d7] hover:underline font-bold text-[11px] truncate max-w-[140px] block"
                            title={t.google_sheet_id}
                          >
                            {t.google_sheet_id}
                          </a>
                          <button
                            onClick={() => {
                              setEditingTeacher(t);
                              setTeacherGSheetInput(t.google_sheet_id || '');
                            }}
                            className="p-1 text-slate-400 hover:text-[#2f53d7] rounded transition-colors"
                            title="Edit Google Sheet"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingTeacher(t);
                            setTeacherGSheetInput('');
                          }}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[11px] font-bold border border-slate-200 flex items-center gap-1 transition-colors"
                        >
                          <Edit className="w-3 h-3 text-slate-400" /> Default Sheet
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Numbered Pagination Controls for Teachers */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-500 border-t border-slate-100">
            <div>
              Showing page <span className="font-bold text-[#17233c]">{teacherPage}</span> of <span className="font-bold text-[#17233c]">{teacherTotalPages}</span> ({teacherTotal} total faculty)
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fetchTeachers(teacherPage - 1)}
                disabled={teacherPage <= 1 || isTeachersLoading}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
              >
                Previous
              </button>
              {Array.from({ length: Math.min(5, teacherTotalPages) }, (_, i) => {
                let p = i + 1;
                if (teacherTotalPages > 5) {
                  p = Math.max(1, Math.min(teacherTotalPages - 4, teacherPage - 2)) + i;
                }
                return (
                  <button
                    key={p}
                    onClick={() => fetchTeachers(p)}
                    disabled={isTeachersLoading}
                    className={`w-8 h-8 rounded-lg font-bold text-xs transition ${
                      teacherPage === p
                        ? 'bg-[#2f53d7] text-white shadow-sm'
                        : 'border border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => fetchTeachers(teacherPage + 1)}
                disabled={teacherPage >= teacherTotalPages || isTeachersLoading}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW TAB: Classes & Dedicated Registers */}
      {activeTab === 'assignments' && (
        <div className="snist-card p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                Faculty Class Assignments & Attendance Registers ({filteredAssignments.length})
              </h3>
              <p className="text-xs text-[#6a7894] mt-0.5">
                Every assigned class (Faculty + Subject + Section) has a dedicated live Excel register (.xlsx) and Google Sheet. Live attendance auto-syncs on every session lock.
              </p>
            </div>

            <button
              onClick={() => {
                setAssignTeacherId(filterTeacherId || '');
                setAssignSubjectId('');
                setAssignSectionId(filterSectionId || '');
                setAssignGSheetId('');
                setIsAssignModalOpen(true);
              }}
              className="px-4 py-2 bg-[#2f53d7] hover:bg-[#15347e] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" /> Assign Faculty to Class
            </button>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by faculty name, subject code, or section..."
                value={assignmentSearch}
                onChange={(e) => setAssignmentSearch(e.target.value)}
                className="snist-input w-full pl-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filterTeacherId}
                onChange={(e) => setFilterTeacherId(e.target.value ? Number(e.target.value) : '')}
                className="snist-input text-xs font-semibold"
              >
                <option value="">All Faculty ({teachers.length})</option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.teacher_code})</option>
                ))}
              </select>

              <select
                value={filterSectionId}
                onChange={(e) => setFilterSectionId(e.target.value ? Number(e.target.value) : '')}
                className="snist-input text-xs font-semibold"
              >
                <option value="">All Sections ({sections.length})</option>
                {sections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              {(filterTeacherId || filterSectionId || assignmentSearch) && (
                <button
                  onClick={() => {
                    setFilterTeacherId('');
                    setFilterSectionId('');
                    setAssignmentSearch('');
                  }}
                  className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 font-bold transition"
                  title="Clear filters"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Assignments Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-[#17233c] font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Faculty Member</th>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Section / Year</th>
                  <th className="py-3 px-4">Enrolled Students</th>
                  <th className="py-3 px-4">Dedicated Excel Register (.xlsx)</th>
                  <th className="py-3 px-4">Class Google Sheet</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredAssignments.length > 0 ? (
                  filteredAssignments.map(asg => (
                    <tr key={asg.id} className="hover:bg-slate-50">
                      
                      {/* Faculty Info */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#17233c]">{asg.teacher_name}</div>
                        <div className="font-mono text-[11px] text-[#2f53d7]">{asg.teacher_code}</div>
                        {asg.department && <div className="text-[10px] text-slate-500 truncate max-w-[180px]">{asg.department}</div>}
                      </td>

                      {/* Subject */}
                      <td className="py-3 px-4">
                        <div className="font-mono font-bold text-slate-800 text-[11px] bg-slate-100 px-1.5 py-0.5 rounded inline-block">
                          {asg.subject_code}
                        </div>
                        <div className="font-semibold text-slate-700 text-xs mt-0.5">{asg.subject_name}</div>
                      </td>

                      {/* Section & Year */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#15347e] text-xs">{asg.section_name}</div>
                        <div className="text-[11px] text-slate-500">{asg.academic_year || 'Academic Year'}</div>
                      </td>

                      {/* Enrolled Students */}
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-bold text-[11px]">
                          <Users className="w-3.5 h-3.5 text-slate-500" />
                          {asg.student_count} Students
                        </span>
                      </td>

                      {/* Dedicated Excel Register Controls */}
                      <td className="py-3 px-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <span 
                              className={`w-2 h-2 rounded-full ${asg.has_excel_register ? 'bg-emerald-500' : 'bg-amber-400'}`} 
                              title={asg.has_excel_register ? 'Live Register Ready' : 'Auto-generated on download'}
                            />
                            <span className="font-mono text-[11px] text-slate-700 truncate max-w-[180px]" title={asg.excel_file_name}>
                              {asg.excel_file_name || `Register_${asg.id}.xlsx`}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {/* Download Button */}
                            <button
                              onClick={() => handleDownloadRegister(asg.id, asg.excel_file_name)}
                              className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg font-bold text-[11px] flex items-center gap-1 shadow-xs transition"
                              title="Download live Excel attendance register"
                            >
                              <Download className="w-3 h-3" /> Download
                            </button>

                            {/* Upload Custom Register Button */}
                            <button
                              onClick={() => {
                                setSelectedAssignmentForUpload(asg);
                                setUploadRegisterFile(null);
                                setIsUploadRegisterModalOpen(true);
                              }}
                              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-bold text-[11px] flex items-center gap-1 transition"
                              title="Upload custom official register template"
                            >
                              <Upload className="w-3 h-3" /> Custom
                            </button>

                            {/* Regenerate Button */}
                            <button
                              onClick={() => handleRegenerateRegister(asg.id)}
                              className="p-1 text-slate-400 hover:text-blue-600 rounded transition"
                              title="Regenerate register with latest enrolled student roster"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Class Google Sheet */}
                      <td className="py-3 px-4">
                        {asg.google_sheet_id ? (
                          <div className="flex items-center gap-1.5">
                            <a
                              href={asg.google_sheet_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-[#2f53d7] hover:underline font-bold text-[11px] truncate max-w-[130px] block"
                              title={asg.google_sheet_id}
                            >
                              {asg.google_sheet_id}
                            </a>
                            <button
                              onClick={() => {
                                setEditingAssignmentGSheet(asg);
                                setAssignmentGSheetInput(asg.google_sheet_id || '');
                              }}
                              className="p-1 text-slate-400 hover:text-[#2f53d7] rounded transition-colors"
                              title="Edit Class Google Sheet ID"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingAssignmentGSheet(asg);
                              setAssignmentGSheetInput('');
                            }}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[11px] font-bold border border-slate-200 flex items-center gap-1 transition-colors"
                          >
                            <Plus className="w-3 h-3 text-slate-400" /> Link Sheet
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleDeleteAssignment(asg.id, `${asg.teacher_name} - ${asg.section_name} (${asg.subject_code})`)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                          title="Unassign Faculty from Class"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>

                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                      No class assignments found matching filters.
                    </td>
                  </tr>
                )}
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

      {/* MODAL 1: Assign Faculty to Class */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#2f53d7]" /> Assign Faculty to Class
              </h3>
              <button 
                onClick={() => setIsAssignModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#6a7894]">
              Assigning a faculty member generates a dedicated, institutional attendance register (.xlsx) tailored specifically for this section and subject.
            </p>

            <form onSubmit={handleAssignClass} className="space-y-3">
              {/* Faculty Selector */}
              <div>
                <label className="block text-xs font-bold text-[#17233c] mb-1">Faculty Member</label>
                <select
                  required
                  value={assignTeacherId}
                  onChange={(e) => setAssignTeacherId(Number(e.target.value))}
                  className="snist-input w-full text-xs font-semibold"
                >
                  <option value="">Select Faculty...</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.teacher_code})</option>
                  ))}
                </select>
              </div>

              {/* Subject Selector */}
              <div>
                <label className="block text-xs font-bold text-[#17233c] mb-1">Subject / Course</label>
                <select
                  required
                  value={assignSubjectId}
                  onChange={(e) => setAssignSubjectId(Number(e.target.value))}
                  className="snist-input w-full text-xs font-semibold"
                >
                  <option value="">Select Subject...</option>
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>
                  ))}
                </select>
              </div>

              {/* Section Selector */}
              <div>
                <label className="block text-xs font-bold text-[#17233c] mb-1">Section</label>
                <select
                  required
                  value={assignSectionId}
                  onChange={(e) => setAssignSectionId(Number(e.target.value))}
                  className="snist-input w-full text-xs font-semibold"
                >
                  <option value="">Select Section...</option>
                  {sections.map(sec => (
                    <option key={sec.id} value={sec.id}>{sec.name} ({sec.department} • {sec.year})</option>
                  ))}
                </select>
              </div>

              {/* Optional Class Google Sheet */}
              <div>
                <label className="block text-xs font-bold text-[#17233c] mb-1">Class Google Sheet ID or URL (Optional)</label>
                <input
                  type="text"
                  placeholder="Paste Google Sheet URL or ID (optional)"
                  value={assignGSheetId}
                  onChange={(e) => setAssignGSheetId(e.target.value)}
                  className="snist-input w-full text-xs"
                />
                <span className="text-[10px] text-slate-400">If left blank, sessions will sync to the faculty's default Google Sheet.</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAssigning}
                  className="px-5 py-2 bg-[#2f53d7] hover:bg-[#15347e] text-white font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {isAssigning ? 'Assigning...' : 'Assign Class & Create Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Upload Custom Register (.xlsx) */}
      {isUploadRegisterModalOpen && selectedAssignmentForUpload && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-[#15347e] flex items-center gap-2">
                <Upload className="w-5 h-5 text-emerald-600" /> Upload Class Attendance Register
              </h3>
              <button 
                onClick={() => setIsUploadRegisterModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
              <div><span className="font-bold text-slate-600">Faculty:</span> <span className="text-[#17233c] font-semibold">{selectedAssignmentForUpload.teacher_name}</span></div>
              <div><span className="font-bold text-slate-600">Class:</span> <span className="text-[#17233c] font-semibold">{selectedAssignmentForUpload.section_name}</span> — {selectedAssignmentForUpload.subject_name}</div>
            </div>

            <p className="text-xs text-[#6a7894]">
              Upload an official SNIST Excel attendance register (.xlsx) for this class. Future session scans will sync directly into this file.
            </p>

            <form onSubmit={handleUploadCustomRegister} className="space-y-3">
              <input
                type="file"
                accept=".xlsx"
                required
                onChange={(e) => setUploadRegisterFile(e.target.files?.[0] || null)}
                className="snist-input w-full text-xs"
              />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsUploadRegisterModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!uploadRegisterFile || isUploadingRegister}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {isUploadingRegister ? 'Uploading...' : 'Save Class Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Edit Class-Specific Google Sheet */}
      {editingAssignmentGSheet && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h3 className="font-heading text-lg font-bold text-[#15347e]">
                  Class Google Sheet Configuration
                </h3>
              </div>
              <button 
                onClick={() => setEditingAssignmentGSheet(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
              <div><span className="font-bold text-slate-600">Faculty:</span> <span className="text-[#17233c] font-semibold">{editingAssignmentGSheet.teacher_name}</span></div>
              <div><span className="font-bold text-slate-600">Class:</span> <span className="text-[#17233c] font-semibold">{editingAssignmentGSheet.section_name}</span> ({editingAssignmentGSheet.subject_code})</div>
            </div>

            <p className="text-xs text-[#6a7894]">
              Assign a dedicated Google Sheet specifically for this class. Attendance recorded by this faculty for this class will sync directly into this sheet. If unassigned, it will use the faculty member's default sheet.
            </p>

            <form onSubmit={handleSaveAssignmentGSheet} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#17233c] mb-1">Google Sheet URL or Spreadsheet ID</label>
                <input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit or Spreadsheet ID"
                  value={assignmentGSheetInput}
                  onChange={(e) => setAssignmentGSheetInput(e.target.value)}
                  className="snist-input w-full text-xs"
                />
              </div>

              {(assignmentGSheetInput.trim() || editingAssignmentGSheet.google_sheet_id) && (
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-600" /> Connected Class Sheet
                    </span>
                    <a
                      href={
                        (assignmentGSheetInput.trim() || editingAssignmentGSheet.google_sheet_id || '').startsWith('http')
                          ? (assignmentGSheetInput.trim() || editingAssignmentGSheet.google_sheet_id || '')
                          : `https://docs.google.com/spreadsheets/d/${assignmentGSheetInput.trim() || editingAssignmentGSheet.google_sheet_id}/edit`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-[#2f53d7] hover:underline flex items-center gap-1"
                    >
                      Open Sheet <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {/* Format Sheet Button */}
                    <button
                      type="button"
                      disabled={isFormattingSheet}
                      onClick={handleFormatAssignmentSheet}
                      className="p-2 bg-white hover:bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                      title="Format sheet with SNIST attendance table and enrolled students roster"
                    >
                      {isFormattingSheet ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Formatting...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" /> Format Template
                        </>
                      )}
                    </button>

                    {/* Sync Roster Button */}
                    <button
                      type="button"
                      disabled={isSyncingRoster}
                      onClick={handleSyncAssignmentRoster}
                      className="p-2 bg-white hover:bg-blue-50 border border-blue-300 text-[#15347e] rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                      title="Read student roll numbers from Google Sheet and enroll into this class section"
                    >
                      {isSyncingRoster ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing...
                        </>
                      ) : (
                        <>
                          <Users className="w-3.5 h-3.5" /> Sync Roster From Sheet
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <div>
                  {editingAssignmentGSheet.google_sheet_id && (
                    <button
                      type="button"
                      onClick={handleClearAssignmentGSheet}
                      className="px-3 py-2 text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded-xl font-bold text-xs transition"
                    >
                      Clear / Unlink
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingAssignmentGSheet(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 snist-btn-primary font-bold text-xs"
                  >
                    Save Class Sheet
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Edit Teacher Individual Google Sheet */}
      {editingTeacher && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-heading text-lg font-bold text-[#15347e]">
              Edit Google Sheet for {editingTeacher.name}
            </h3>

            <form onSubmit={handleSaveTeacherGSheet} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#17233c] mb-1">Spreadsheet ID or URL</label>
                <input
                  type="text"
                  placeholder="e.g. 1zv8ahGuDQ0KPAYXNSRHyUWIERhwd3ev3599V3nVDO5Y"
                  value={teacherGSheetInput}
                  onChange={(e) => setTeacherGSheetInput(e.target.value)}
                  className="snist-input w-full text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTeacher(null)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 snist-btn-primary font-bold text-xs"
                >
                  Save Sheet ID
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Add Student */}
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

      {/* MODAL 6: Bulk Import */}
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
