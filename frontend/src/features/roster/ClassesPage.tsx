import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  RefreshCw,
  Plus,
  BookOpen,
  GraduationCap,
  Calendar,
  Trash2,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { PageHeader } from '../../components/dashboard/PageHeader';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { api } from '../../core/api/client';
import { z } from 'zod';
import {
  useRosterTeachersQuery,
  useRosterSectionsQuery,
  useRosterSubjectsQuery,
} from './hooks';
import { useAuth } from '../../context/AuthContext';

export interface ClassAssignment {
  id: number;
  teacher_id: number;
  teacher_code: string;
  teacher_name: string;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  section_id: number;
  section_name: string;
  department: string;
  academic_year: string;
  student_count: number;
  excel_file_name?: string;
  has_excel_register?: boolean;
  google_sheet_id?: string;
  google_sheet_url?: string;
  schedule_text?: string;
}

export const ClassesPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = (user?.role || '').toLowerCase().includes('admin');
  const [searchParams] = useSearchParams();
  const openId = searchParams.get('open');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState<string>('');
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [selectedSubjectId, setSelectedSubjectId] = useState<number>(1);
  const [selectedSectionId, setSelectedSectionId] = useState<number>(1);
  const [selectedTeacherId, setSelectedTeacherId] = useState<number>(1);
  const [scheduleText, setScheduleText] = useState<string>('Mon, Wed, Fri 09:30 - 10:30 AM');

  // Metadata queries
  const teachersQuery = useRosterTeachersQuery();
  const sectionsQuery = useRosterSectionsQuery();
  const subjectsQuery = useRosterSubjectsQuery();

  // Assignments Query
  const assignmentsQuery = useQuery({
    queryKey: ['admin', 'assignments'],
    queryFn: () => api<ClassAssignment[]>('/api/v1/admin/assignments', z.any()),
  });

  const createAssignmentMutation = useMutation({
    mutationFn: (body: { teacher_id: number; subject_id: number; section_id: number }) =>
      api<{ message: string; id: number }>('/api/v1/admin/assignments', z.any(), {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'assignments'] });
      setIsDialogOpen(false);
    },
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: (assignmentId: number) =>
      api<{ message: string }>(`/api/v1/admin/assignments/${assignmentId}`, z.any(), {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'assignments'] });
    },
  });

  const teachers = Array.isArray(teachersQuery.data) ? teachersQuery.data : [];
  const sections = Array.isArray(sectionsQuery.data) ? sectionsQuery.data : [];
  const subjects = Array.isArray(subjectsQuery.data) ? subjectsQuery.data : [];
  const assignments: ClassAssignment[] = Array.isArray(assignmentsQuery.data)
    ? assignmentsQuery.data
    : [];

  const filteredAssignments = assignments.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (a.subject_name || '').toLowerCase().includes(q) ||
      (a.subject_code || '').toLowerCase().includes(q) ||
      (a.teacher_name || '').toLowerCase().includes(q) ||
      (a.section_name || '').toLowerCase().includes(q) ||
      (a.department || '').toLowerCase().includes(q)
    );
  });

  const handleOpenCreate = () => {
    if (subjects.length > 0) setSelectedSubjectId(subjects[0].id);
    if (sections.length > 0) setSelectedSectionId(sections[0].id);
    if (teachers.length > 0) setSelectedTeacherId(teachers[0].id);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAssignmentMutation.mutateAsync({
        teacher_id: Number(selectedTeacherId),
        subject_id: Number(selectedSubjectId),
        section_id: Number(selectedSectionId),
      });
    } catch (err: any) {
      setFormError(err.message || 'Failed to allocate class to faculty.');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to remove this class allocation?')) return;
    try {
      await deleteAssignmentMutation.mutateAsync(id);
    } catch (err: any) {
      alert(`Deletion failed: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class Allocations"
        description="Course sections, assigned faculty educators, schedules, and active student rosters"
        actions={
          isAdmin ? (
            <Button
              onClick={handleOpenCreate}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Assign Class</span>
            </Button>
          ) : undefined
        }
      />

      <ChartCard
        title="Active Course Sections"
        subtitle={`${assignments.length} classes scheduled across all departments`}
        toolbar={
          <div className="flex items-center gap-3">
            <div className="relative w-48 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search course, teacher, sec..."
                className="h-8 pl-8 text-xs bg-[#141416] border-[#2a2b31] text-white focus-visible:ring-indigo-500"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => assignmentsQuery.refetch()}
              disabled={assignmentsQuery.isFetching}
              className="h-8 px-2.5 text-xs border-[#2a2b31] bg-[#141416] hover:bg-[#2a2b31] text-slate-300"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${assignmentsQuery.isFetching ? 'animate-spin text-indigo-400' : ''}`}
              />
            </Button>
          </div>
        }
      >
        {assignmentsQuery.isError && (
          <div className="p-8 text-center bg-rose-500/10 border border-rose-500/20 rounded-lg">
            <AlertCircle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-rose-200">Unable to load classes</h4>
            <p className="text-xs text-rose-300/80 mt-1 max-w-sm mx-auto">
              {(assignmentsQuery.error as any)?.message || 'Service could not be reached.'}
            </p>
          </div>
        )}

        {assignmentsQuery.isLoading && (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full bg-[#2a2b31]/40 animate-pulse rounded flex items-center justify-between px-4"
              >
                <div className="h-3 w-28 bg-[#2a2b31] rounded" />
                <div className="h-3 w-40 bg-[#2a2b31] rounded" />
                <div className="h-3 w-20 bg-[#2a2b31] rounded" />
              </div>
            ))}
          </div>
        )}

        {!assignmentsQuery.isLoading && !assignmentsQuery.isError && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#2a2b31] text-[#9ca3af] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Subject & Code</th>
                  <th className="py-2.5 px-3">Section</th>
                  <th className="py-2.5 px-3">Faculty In-Charge</th>
                  <th className="py-2.5 px-3">Schedule</th>
                  <th className="py-2.5 px-3">Roster Size</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
                {filteredAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#9ca3af]">
                      No class allocations match "{search}".
                    </td>
                  </tr>
                ) : (
                  filteredAssignments.map((a) => {
                    const isMatch = Boolean(
                      openId &&
                        (String(a.id) === openId ||
                          String(a.subject_id) === openId ||
                          a.subject_code?.toLowerCase() === openId.toLowerCase())
                    );

                    return (
                      <tr
                        key={a.id}
                        className={`hover:bg-[#2a2b31]/30 transition-all group ${
                          isMatch ? 'bg-indigo-500/20 ring-1 ring-indigo-500/50 animate-pulse' : ''
                        }`}
                      >
                      <td className="py-2.5 px-3 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{a.subject_name || 'Subject'}</span>
                        </div>
                        <div className="text-[11px] text-[#9ca3af] font-mono ml-5">
                          {a.subject_code || `SUB-${a.subject_id}`}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#1e1f24] border border-[#2a2b31] text-slate-200">
                          {a.section_name || 'General'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-white">
                        <div className="flex items-center gap-1.5">
                          <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
                          <span>{a.teacher_name || 'Assigned Faculty'}</span>
                        </div>
                        <div className="text-[11px] text-[#9ca3af] font-mono ml-5">
                          {a.teacher_code}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[#9ca3af]">
                        <div className="flex items-center gap-1 text-[11px]">
                          <Calendar className="w-3 h-3 text-slate-500" />
                          <span>{a.schedule_text || 'Standard Timetable (10:00 AM)'}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">
                        <span className="font-semibold text-white">{a.student_count || 64}</span>{' '}
                        students
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(a.id)}
                            className="h-7 w-7 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {/* Create Assignment Dialog */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#1e1f24] border border-[#2a2b31] w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2a2b31] pb-3">
              <h3 className="text-base font-bold text-white">Assign Class to Faculty</h3>
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

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">Subject / Course *</label>
                <select
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(Number(e.target.value))}
                  className="w-full h-8 px-2 rounded-lg bg-[#141416] border border-[#2a2b31] text-white text-xs"
                >
                  {subjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name} ({sub.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">Class Section *</label>
                <select
                  value={selectedSectionId}
                  onChange={(e) => setSelectedSectionId(Number(e.target.value))}
                  className="w-full h-8 px-2 rounded-lg bg-[#141416] border border-[#2a2b31] text-white text-xs"
                >
                  {sections.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {sec.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">Faculty Member *</label>
                <select
                  value={selectedTeacherId}
                  onChange={(e) => setSelectedTeacherId(Number(e.target.value))}
                  className="w-full h-8 px-2 rounded-lg bg-[#141416] border border-[#2a2b31] text-white text-xs"
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.teacher_code || t.department || 'Faculty'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">Schedule Timetable</label>
                <Input
                  value={scheduleText}
                  onChange={(e) => setScheduleText(e.target.value)}
                  placeholder="e.g. Mon, Wed, Fri 09:30 - 10:30 AM"
                  className="h-8 bg-[#141416] border-[#2a2b31] text-white"
                />
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
                  disabled={createAssignmentMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                >
                  {createAssignmentMutation.isPending ? 'Allocating...' : 'Allocate Class'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassesPage;
