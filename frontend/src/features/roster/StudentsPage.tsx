import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Plus,
  MoreVertical,
  CalendarCheck,
  Edit,
  UserX,
  UserCheck,
  CheckCircle2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/dashboard/PageHeader';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import {
  useRosterStudentsQuery,
  useRosterDepartmentsQuery,
  useRosterSectionsQuery,
  useRosterYearsQuery,
  useRosterSaveStudentMutation,
} from './hooks';
import { keys } from '../../core/api/keys';
import { Student } from '../../core/api/schemas/roster';

export const StudentsPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQ = searchParams.get('q') || '';
  const initialPage = Number(searchParams.get('page')) || 1;

  const [search, setSearch] = useState<string>(initialQ);
  const [debouncedQ, setDebouncedQ] = useState<string>(initialQ);
  const [page, setPage] = useState<number>(initialPage);
  const pageSize = 10;

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [activeKebabId, setActiveKebabId] = useState<number | string | null>(null);
  const [deactivateConfirmTarget, setDeactivateConfirmTarget] = useState<Student | null>(null);

  // Form Fields per models.py Student
  const [formData, setFormData] = useState<{
    id?: number;
    roll_number: string;
    name: string;
    email: string;
    mobile: string;
    department_id: number;
    academic_year_id: number;
    section_id: number;
    agency: string;
    is_active: boolean;
  }>({
    roll_number: '',
    name: '',
    email: '',
    mobile: '',
    department_id: 1,
    academic_year_id: 1,
    section_id: 1,
    agency: 'Regular',
    is_active: true,
  });

  const [formError, setFormError] = useState<string | null>(null);

  // Query metadata for selects
  const deptQuery = useRosterDepartmentsQuery();
  const secQuery = useRosterSectionsQuery();
  const yrQuery = useRosterYearsQuery();

  // 250ms debounce on search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQ(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(handler);
  }, [search]);

  // Sync to URL search params
  useEffect(() => {
    const nextParams: Record<string, string> = {};
    if (debouncedQ) nextParams.q = debouncedQ;
    if (page > 1) nextParams.page = String(page);
    setSearchParams(nextParams, { replace: true });
  }, [debouncedQ, page, setSearchParams]);

  const query = useRosterStudentsQuery({
    page,
    page_size: pageSize,
    q: debouncedQ || undefined,
  });

  const saveMutation = useRosterSaveStudentMutation();

  const students: Student[] = Array.isArray(query.data) ? query.data : query.data?.items || [];
  const total = Array.isArray(query.data) ? query.data.length : query.data?.total || students.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const departments = Array.isArray(deptQuery.data) ? deptQuery.data : [];
  const sections = Array.isArray(secQuery.data) ? secQuery.data : [];
  const years = Array.isArray(yrQuery.data) ? yrQuery.data : [];

  const handleOpenCreate = () => {
    setDialogMode('create');
    setFormData({
      roll_number: '',
      name: '',
      email: '',
      mobile: '',
      department_id: departments[0]?.id || 1,
      academic_year_id: years[0]?.id || 1,
      section_id: sections[0]?.id || 1,
      agency: 'Regular',
      is_active: true,
    });
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (student: Student) => {
    setDialogMode('edit');
    setFormData({
      id: student.id,
      roll_number: student.roll_number,
      name: student.name,
      email: student.email || '',
      mobile: student.mobile || '',
      department_id: student.department_id || departments[0]?.id || 1,
      academic_year_id: student.academic_year_id || years[0]?.id || 1,
      section_id: student.section_id || sections[0]?.id || 1,
      agency: student.agency || 'Regular',
      is_active: student.is_active !== false,
    });
    setFormError(null);
    setActiveKebabId(null);
    setIsDialogOpen(true);
  };

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.roll_number.trim() || !formData.name.trim()) {
      setFormError('Roll Number / SAP ID and Student Name are required.');
      return;
    }

    try {
      await saveMutation.mutateAsync({
        id: formData.id,
        roll_number: formData.roll_number.trim().toUpperCase(),
        name: formData.name.trim(),
        email: formData.email.trim() || undefined,
        mobile: formData.mobile.trim() || undefined,
        department_id: Number(formData.department_id),
        academic_year_id: Number(formData.academic_year_id),
        section_id: Number(formData.section_id),
        agency: formData.agency,
        is_active: formData.is_active,
      } as any);

      // Invalidate roster and overview keys
      await queryClient.invalidateQueries({ queryKey: keys.roster.all() });
      await queryClient.invalidateQueries({ queryKey: keys.overview.all() });
      await queryClient.invalidateQueries({ queryKey: keys.attendance.dashboardStats() });

      setIsDialogOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save student record.');
    }
  };

  const handleToggleActive = async (student: Student) => {
    try {
      const nextStatus = student.is_active === false;
      await saveMutation.mutateAsync({
        id: student.id,
        roll_number: student.roll_number,
        name: student.name,
        department_id: student.department_id || 1,
        academic_year_id: student.academic_year_id || 1,
        section_id: student.section_id || 1,
        is_active: nextStatus,
      } as any);

      await queryClient.invalidateQueries({ queryKey: keys.roster.all() });
      setDeactivateConfirmTarget(null);
      setActiveKebabId(null);
    } catch (err: any) {
      alert(`Status update failed: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Directory"
        description="Canonical student roster, SAP identity mappings, and active enrollment statuses"
        actions={
          <Button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Student</span>
          </Button>
        }
      />

      <ChartCard
        title="Enrolled Students"
        subtitle="Search by SAP ID, roll number, or legal student name"
        toolbar={
          <div className="flex items-center gap-3">
            <div className="relative w-48 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, roll, SAP..."
                className="h-8 pl-8 text-xs bg-[#141416] border-[#2a2b31] text-white focus-visible:ring-indigo-500"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="h-8 px-2.5 text-xs border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-slate-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin text-indigo-400' : ''}`} />
            </Button>
          </div>
        }
      >
        {query.isError && (
          <div className="p-8 text-center bg-rose-500/10 border border-rose-500/20 rounded-lg">
            <AlertCircle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-rose-200">Unable to load students</h4>
            <p className="text-xs text-rose-300/80 mt-1 max-w-sm mx-auto">
              {(query.error as any)?.message || 'Service could not be reached.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              className="mt-3 text-xs border-rose-500/30 text-rose-200 hover:bg-rose-500/20"
            >
              Retry Connection
            </Button>
          </div>
        )}

        {query.isLoading && (
          <div className="space-y-2 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full bg-[#2a2b31]/40 animate-pulse rounded flex items-center justify-between px-4"
              >
                <div className="h-3 w-20 bg-[#2a2b31] rounded" />
                <div className="h-3 w-36 bg-[#2a2b31] rounded" />
                <div className="h-3 w-24 bg-[#2a2b31] rounded" />
                <div className="h-4 w-12 bg-[#2a2b31] rounded-full" />
              </div>
            ))}
          </div>
        )}

        {!query.isLoading && !query.isError && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#2a2b31] text-[#9ca3af] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Roll / SAP ID</th>
                  <th className="py-2.5 px-3">Student Name</th>
                  <th className="py-2.5 px-3">Branch & Section</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Enrolled</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#9ca3af]">
                      No student records match "{debouncedQ}".
                    </td>
                  </tr>
                ) : (
                  students.map((student) => {
                    const isActive = student.is_active !== false;
                    const studentId = student.id || student.roll_number;
                    const isKebabOpen = activeKebabId === studentId;

                    return (
                      <tr
                        key={studentId}
                        className="hover:bg-[#2a2b31]/30 transition-colors"
                      >
                        <td className="py-2.5 px-3 font-mono font-medium text-indigo-400">
                          {student.roll_number}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-white">
                          <div>{student.name}</div>
                          {student.email && (
                            <div className="text-[11px] text-[#9ca3af]">{student.email}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-slate-300">
                            {student.department || 'AIML'} · {student.section || 'General'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              isActive
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            }`}
                          >
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[#9ca3af] font-mono">
                          {student.join_date || student.year || '2024'}
                        </td>
                        <td className="py-2.5 px-3 text-right relative">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveKebabId(isKebabOpen ? null : studentId)}
                            className="h-7 w-7 p-0 text-[#9ca3af] hover:text-white hover:bg-[#2a2b31]"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>

                          {/* Kebab Dropdown Menu */}
                          {isKebabOpen && (
                            <div
                              className="absolute right-3 top-8 z-30 w-44 rounded-xl bg-[#1e1f24] border border-[#2a2b31] shadow-xl py-1 text-left text-xs animate-in fade-in zoom-in-95 duration-100"
                              onMouseLeave={() => setActiveKebabId(null)}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveKebabId(null);
                                  navigate(`/attendance/day?student=${encodeURIComponent(student.roll_number)}`);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-slate-300 hover:text-white hover:bg-white/[0.05] transition-colors"
                              >
                                <CalendarCheck className="w-3.5 h-3.5 text-indigo-400" />
                                <span>View Register</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(student)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-slate-300 hover:text-white hover:bg-white/[0.05] transition-colors"
                              >
                                <Edit className="w-3.5 h-3.5 text-blue-400" />
                                <span>Edit Student</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveKebabId(null);
                                  setDeactivateConfirmTarget(student);
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-2 transition-colors ${
                                  isActive
                                    ? 'text-rose-400 hover:bg-rose-500/10'
                                    : 'text-emerald-400 hover:bg-emerald-500/10'
                                }`}
                              >
                                {isActive ? (
                                  <>
                                    <UserX className="w-3.5 h-3.5" />
                                    <span>Deactivate</span>
                                  </>
                                ) : (
                                  <>
                                    <UserCheck className="w-3.5 h-3.5" />
                                    <span>Activate</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Pagination Controls */}
            <div className="mt-4 pt-3 border-t border-[#2a2b31]/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#9ca3af]">
              <div>
                Showing{' '}
                <span className="text-white font-medium">
                  {students.length > 0 ? (page - 1) * pageSize + 1 : 0}
                </span>{' '}
                to{' '}
                <span className="text-white font-medium">
                  {Math.min(page * pageSize, total)}
                </span>{' '}
                of <span className="text-white font-medium">{total}</span> enrolled students
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || query.isFetching}
                  className="h-7 px-2 border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-xs"
                >
                  <ChevronLeft className="w-3.5 h-3.5 mr-0.5" /> Prev
                </Button>
                <span className="text-slate-300 font-mono px-1">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || query.isFetching}
                  className="h-7 px-2 border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-xs"
                >
                  Next <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </ChartCard>

      {/* Create / Edit Student Dialog */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#1e1f24] border border-[#2a2b31] w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2a2b31] pb-3">
              <h3 className="text-base font-bold text-white">
                {dialogMode === 'create' ? 'Enroll New Student' : 'Edit Student Record'}
              </h3>
              <button
                type="button"
                onClick={() => setIsDialogOpen(false)}
                className="text-[#9ca3af] hover:text-white text-lg font-bold"
              >
                &times;
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-lg">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[#9ca3af] font-medium">Roll Number / SAP ID *</label>
                  <Input
                    required
                    disabled={dialogMode === 'edit'}
                    value={formData.roll_number}
                    onChange={(e) => setFormData({ ...formData, roll_number: e.target.value })}
                    placeholder="e.g. 2101A0501"
                    className="h-8 bg-[#141416] border-[#2a2b31] text-white font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[#9ca3af] font-medium">Student Full Name *</label>
                  <Input
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Bhaskar Sharma"
                    className="h-8 bg-[#141416] border-[#2a2b31] text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[#9ca3af] font-medium">Email Address</label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="student@snist.edu"
                    className="h-8 bg-[#141416] border-[#2a2b31] text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[#9ca3af] font-medium">Mobile Number</label>
                  <Input
                    value={formData.mobile}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    placeholder="9876543210"
                    className="h-8 bg-[#141416] border-[#2a2b31] text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[#9ca3af] font-medium">Department</label>
                  <select
                    value={formData.department_id}
                    onChange={(e) => setFormData({ ...formData, department_id: Number(e.target.value) })}
                    className="w-full h-8 px-2 rounded-lg bg-[#141416] border border-[#2a2b31] text-white text-xs"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[#9ca3af] font-medium">Academic Year</label>
                  <select
                    value={formData.academic_year_id}
                    onChange={(e) => setFormData({ ...formData, academic_year_id: Number(e.target.value) })}
                    className="w-full h-8 px-2 rounded-lg bg-[#141416] border border-[#2a2b31] text-white text-xs"
                  >
                    {years.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[#9ca3af] font-medium">Section</label>
                  <select
                    value={formData.section_id}
                    onChange={(e) => setFormData({ ...formData, section_id: Number(e.target.value) })}
                    className="w-full h-8 px-2 rounded-lg bg-[#141416] border border-[#2a2b31] text-white text-xs"
                  >
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="status-toggle"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="rounded border-[#2a2b31] bg-[#141416] text-indigo-600 focus:ring-0"
                />
                <label htmlFor="status-toggle" className="text-slate-300 font-medium cursor-pointer">
                  Student Enrollment Active
                </label>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#2a2b31]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDialogOpen(false)}
                  className="border-[#2a2b31] text-slate-300 hover:bg-[#2a2b31]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={saveMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                >
                  {saveMutation.isPending ? 'Saving...' : dialogMode === 'create' ? 'Create Student' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivate Confirm Dialog */}
      {deactivateConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#1e1f24] border border-[#2a2b31] w-full max-w-sm rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">
              {deactivateConfirmTarget.is_active !== false ? 'Deactivate Student?' : 'Reactivate Student?'}
            </h3>
            <p className="text-xs text-[#9ca3af] leading-relaxed">
              Are you sure you want to{' '}
              {deactivateConfirmTarget.is_active !== false ? 'deactivate' : 'reactivate'}{' '}
              <strong className="text-white">{deactivateConfirmTarget.name}</strong> ({deactivateConfirmTarget.roll_number})?
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeactivateConfirmTarget(null)}
                className="border-[#2a2b31] text-slate-300 hover:bg-[#2a2b31]"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => handleToggleActive(deactivateConfirmTarget)}
                className={
                  deactivateConfirmTarget.is_active !== false
                    ? 'bg-rose-600 hover:bg-rose-700 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentsPage;
