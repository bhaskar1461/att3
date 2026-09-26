import React, { useState } from 'react';
import {
  Search,
  RefreshCw,
  AlertCircle,
  Edit,
  GraduationCap,
  ExternalLink,
  FileSpreadsheet,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/dashboard/PageHeader';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import {
  useRosterTeachersQuery,
  useRosterDepartmentsQuery,
  useRosterUpdateTeacherSheetMutation,
} from './hooks';
import { keys } from '../../core/api/keys';
import { Teacher } from '../../core/api/schemas/roster';

export const TeachersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState<string>('');
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  const query = useRosterTeachersQuery();
  const deptQuery = useRosterDepartmentsQuery();
  const updateSheetMutation = useRosterUpdateTeacherSheetMutation();

  const teachers: Teacher[] = Array.isArray(query.data) ? query.data : [];
  const departments = Array.isArray(deptQuery.data) ? deptQuery.data : [];

  const filteredTeachers = teachers.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      (t.teacher_code || '').toLowerCase().includes(q) ||
      (t.department || '').toLowerCase().includes(q) ||
      (t.username || '').toLowerCase().includes(q)
    );
  });

  const handleOpenEdit = (t: Teacher) => {
    setEditingTeacher(t);
    setSheetUrl(t.google_sheet_url || t.google_sheet_id || '');
    setFormError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacher) return;

    try {
      await updateSheetMutation.mutateAsync({
        teacherId: editingTeacher.id,
        googleSheetUrl: sheetUrl.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: keys.roster.teachers() });
      setEditingTeacher(null);
    } catch (err: any) {
      setFormError(err.message || 'Failed to update teacher settings.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty Directory"
        description="Faculty members, institutional codes, department affiliations, and synchronized attendance registers"
      />

      <ChartCard
        title="Faculty Members"
        subtitle={`${teachers.length} registered teachers across all departments`}
        toolbar={
          <div className="flex items-center gap-3">
            <div className="relative w-48 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search teacher, code, dept..."
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
            <h4 className="text-sm font-semibold text-rose-200">Unable to load faculty records</h4>
            <p className="text-xs text-rose-300/80 mt-1 max-w-sm mx-auto">
              {(query.error as any)?.message || 'Service could not be reached.'}
            </p>
          </div>
        )}

        {query.isLoading && (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full bg-[#2a2b31]/40 animate-pulse rounded flex items-center justify-between px-4"
              >
                <div className="h-3 w-24 bg-[#2a2b31] rounded" />
                <div className="h-3 w-40 bg-[#2a2b31] rounded" />
                <div className="h-3 w-28 bg-[#2a2b31] rounded" />
              </div>
            ))}
          </div>
        )}

        {!query.isLoading && !query.isError && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#2a2b31] text-[#9ca3af] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Faculty Code / SAP</th>
                  <th className="py-2.5 px-3">Full Name</th>
                  <th className="py-2.5 px-3">Department</th>
                  <th className="py-2.5 px-3">Assigned Classes</th>
                  <th className="py-2.5 px-3">Google Sheet Sync</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2b31]/40 text-slate-200">
                {filteredTeachers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#9ca3af]">
                      No faculty records match "{search}".
                    </td>
                  </tr>
                ) : (
                  filteredTeachers.map((t) => (
                    <tr
                      key={t.id}
                      className="hover:bg-[#2a2b31]/30 transition-colors group"
                    >
                      <td className="py-2.5 px-3 font-mono font-medium text-indigo-400">
                        {t.teacher_code || `FAC-${t.id}`}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
                          <span>{t.name}</span>
                        </div>
                        {t.username && (
                          <div className="text-[11px] text-[#9ca3af] ml-5">{t.username}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {t.department || 'General Engineering'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          {t.assigned_count ?? 1} sections
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[#9ca3af]">
                        {t.google_sheet_url || t.google_sheet_id ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <FileSpreadsheet className="w-3 h-3" />
                            <span className="font-mono text-[11px]">Synced</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 italic">Not configured</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(t)}
                          className="h-7 px-2 text-slate-400 hover:text-white hover:bg-[#2a2b31] text-xs inline-flex items-center gap-1"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {/* Edit Teacher Dialog */}
      {editingTeacher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#1e1f24] border border-[#2a2b31] w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2a2b31] pb-3">
              <h3 className="text-base font-bold text-white">Edit Faculty Configuration</h3>
              <button
                type="button"
                onClick={() => setEditingTeacher(null)}
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

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">Faculty Member</label>
                <div className="p-2.5 rounded-lg bg-[#141416] border border-[#2a2b31] text-white font-medium">
                  {editingTeacher.name} ({editingTeacher.teacher_code || `ID: ${editingTeacher.id}`})
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[#9ca3af] font-medium">Google Sheet URL or ID</label>
                <Input
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="h-8 bg-[#141416] border-[#2a2b31] text-white font-mono"
                />
                <p className="text-[11px] text-[#9ca3af]">
                  Live attendance sessions will sync directly to this spreadsheet tab.
                </p>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#2a2b31]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingTeacher(null)}
                  className="border-[#2a2b31] text-slate-300 hover:bg-[#2a2b31]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={updateSheetMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                >
                  {updateSheetMutation.isPending ? 'Saving...' : 'Save Settings'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeachersPage;
