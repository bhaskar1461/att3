import React, { useState, useEffect, useRef } from 'react';
import { 
  X, ChevronLeft, Search, RefreshCw, Smartphone, 
  CheckCircle2, XCircle, AlertCircle, ArrowUpDown, ChevronDown, ChevronUp,
  Building2, Users, UserCheck, ShieldCheck, Layers, PieChart, Table as TableIcon, FileText
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { RawSessionAuditModal } from '../RawSessionAuditModal';

interface DepartmentMetric {
  id: number;
  code: string;
  name: string;
  count: number;
  share_pct: number;
  percentage?: number;
  defaulters_count?: number;
}

interface EnrollmentOverviewResponse {
  total_enrolled: number;
  departments: DepartmentMetric[];
}

interface StudentRosterItem {
  id: number;
  roll_number: string;
  name: string;
  email: string | null;
  mobile: string | null;
  agency: string;
  department_id: number;
  department_name: string;
  department_code: string;
  academic_year: string;
  section_name: string;
  registered_device_id: number | null;
  device_bound: boolean;
  present_today: boolean;
  attendance_percentage?: number | null;
  display_percentage?: string;
  band?: 'ELIGIBLE' | 'CONDONABLE' | 'DETAINED' | string;
  courses_below_75_count?: number;
  condonation_status?: string;
  join_date?: string | null;
  attendance_summary: {
    attended_sessions: number;
    total_sessions: number;
    attendance_percentage: number | null;
    display_percentage?: string;
    band?: string;
    courses_below_75_count?: number;
    condonation_status?: string;
  };
}

interface DepartmentEnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDepartmentId?: number | null;
}

export const DepartmentEnrollmentModal: React.FC<DepartmentEnrollmentModalProps> = ({
  isOpen,
  onClose,
  initialDepartmentId = null
}) => {
  // Navigation state
  const [selectedDept, setSelectedDept] = useState<DepartmentMetric | null>(null);
  const [viewMode, setViewMode] = useState<'DIAGRAM' | 'TABLE'>('DIAGRAM');

  // Level 1: Department Structure Data
  const [overview, setOverview] = useState<EnrollmentOverviewResponse | null>(null);
  const [isOverviewLoading, setIsOverviewLoading] = useState<boolean>(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Mermaid SVG State
  const mermaidContainerRef = useRef<HTMLDivElement>(null);
  const [isMermaidRendering, setIsMermaidRendering] = useState<boolean>(false);
  const [mermaidError, setMermaidError] = useState<boolean>(false);

  // Level 2: Student Roster Data
  const [students, setStudents] = useState<StudentRosterItem[]>([]);
  const [isStudentsLoading, setIsStudentsLoading] = useState<boolean>(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);

  // Student list controls
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterPresence, setFilterPresence] = useState<'ALL' | 'PRESENT' | 'ABSENT' | 'BOUND' | 'UNBOUND'>('ALL');
  const [sortField, setSortField] = useState<'roll_number' | 'name' | 'section_name' | 'percentage'>('roll_number');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [expandedStudentId, setExpandedStudentId] = useState<number | null>(null);
  const [auditRollNumber, setAuditRollNumber] = useState<string | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);

  // Fetch Level 1 Overview on Open
  useEffect(() => {
    if (!isOpen) {
      setSelectedDept(null);
      setStudents([]);
      setSearchTerm('');
      setExpandedStudentId(null);
      return;
    }
    fetchOverview();
  }, [isOpen]);

  const fetchOverview = async () => {
    setIsOverviewLoading(true);
    setOverviewError(null);
    setMermaidError(false);
    try {
      const data = await apiRequest<EnrollmentOverviewResponse>('/admin/analytics/enrollment');
      setOverview(data);
      if (initialDepartmentId && data.departments) {
        const target = data.departments.find(d => d.id === initialDepartmentId);
        if (target) {
          handleSelectDepartment(target);
        }
      }
    } catch (err: any) {
      console.error('Error fetching enrollment overview:', err);
      setOverviewError(err.message || 'Failed to load enrollment analytics.');
    } finally {
      setIsOverviewLoading(false);
    }
  };

  // Helper to sanitize text for Mermaid flowchart syntax
  const sanitizeForMermaid = (str: string): string => {
    if (!str) return '';
    return str
      .replace(/"/g, "'")
      .replace(/[\n\r]/g, ' ')
      .replace(/[[\]{}()]/g, ' ')
      .replace(/[<>&]/g, ' ')
      .trim();
  };

  // Render Mermaid flowchart whenever overview data is available and in DIAGRAM view
  useEffect(() => {
    if (!overview || selectedDept || viewMode !== 'DIAGRAM' || !isOpen) return;

    let isMounted = true;

    const renderChart = async () => {
      setIsMermaidRendering(true);
      setMermaidError(false);
      try {
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          securityLevel: 'loose',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: 'basis'
          }
        });

        const totalEnrolled = overview.total_enrolled;
        const depts = overview.departments;

        // Build flowchart definition
        let graphDef = 'graph TD\n';
        graphDef += `  SNIST["🏫 <b>SREENIDHI INSTITUTE</b><br/><b>${totalEnrolled} Total Enrolled Students</b>"]\n`;

        depts.forEach(d => {
          const safeCode = sanitizeForMermaid(d.code);
          const safeName = sanitizeForMermaid(d.name);
          const nodeId = `dept_${d.id < 0 ? 'unassigned' : d.id}`;
          const defaultersBadge = (d.defaulters_count !== undefined && d.defaulters_count > 0)
            ? `<br/><b>⚠️ ${d.defaulters_count} Defaulters</b>`
            : '';
          
          graphDef += `  SNIST --> ${nodeId}["<b>${safeCode}</b><br/>${safeName}<br/><b>${d.count} Students (${d.share_pct}%)</b>${defaultersBadge}"]\n`;
        });

        // Add visual color classes based on student share proportion
        graphDef += '\n  classDef rootNode fill:#eff6ff,stroke:#1d4ed8,stroke-width:2.5px,color:#1e3a8a,font-size:13px;\n';
        graphDef += '  classDef highShare fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#064e3b,cursor:pointer;\n';
        graphDef += '  classDef midShare fill:#f0f9ff,stroke:#0284c7,stroke-width:2px,color:#0c4a6e,cursor:pointer;\n';
        graphDef += '  classDef lowShare fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#78350f,cursor:pointer;\n';
        graphDef += '  classDef unassignedNode fill:#f8fafc,stroke:#64748b,stroke-width:2px,stroke-dasharray: 4 4,color:#334155,cursor:pointer;\n';
        
        graphDef += '  class SNIST rootNode;\n';

        depts.forEach(d => {
          const nodeId = `dept_${d.id < 0 ? 'unassigned' : d.id}`;
          if (d.id < 0) {
            graphDef += `  class ${nodeId} unassignedNode;\n`;
          } else if (d.share_pct >= 20) {
            graphDef += `  class ${nodeId} highShare;\n`;
          } else if (d.share_pct >= 10) {
            graphDef += `  class ${nodeId} midShare;\n`;
          } else {
            graphDef += `  class ${nodeId} lowShare;\n`;
          }
        });

        const uniqueId = `mermaid_chart_${Date.now()}`;
        const { svg } = await mermaid.render(uniqueId, graphDef);

        if (!isMounted || !mermaidContainerRef.current) return;

        mermaidContainerRef.current.innerHTML = svg;

        // Attach click listeners to SVG nodes for Level 2 drill-down
        const svgElement = mermaidContainerRef.current.querySelector('svg');
        if (svgElement) {
          svgElement.style.width = '100%';
          svgElement.style.height = 'auto';
          svgElement.style.maxHeight = '520px';

          // Inject custom styles into SVG to force pointer cursor and hover state
          const styleEl = document.createElement('style');
          styleEl.textContent = `
            .node { cursor: pointer !important; }
            .node * { cursor: pointer !important; }
            .node:hover { filter: drop-shadow(0 6px 12px rgba(47, 83, 215, 0.25)) brightness(0.95) !important; }
          `;
          svgElement.prepend(styleEl);

          const sortedDepts = [...depts].sort((a, b) => b.code.length - a.code.length);
          const allNodes = svgElement.querySelectorAll('.node');

          allNodes.forEach(node => {
            const el = node as HTMLElement;
            const elId = el.id || '';
            const elText = (el.textContent || '').trim();

            // Skip root SNIST node
            if (elId.toLowerCase().includes('snist') || elText.toLowerCase().includes('sreenidhi institute')) {
              return;
            }

            el.style.cursor = 'pointer';

            // Match department by id, code, or name
            const matchedDept = sortedDepts.find(d => {
              const nodeId = `dept_${d.id < 0 ? 'unassigned' : d.id}`;
              return elId.includes(nodeId) || elText.includes(d.code) || (d.name && elText.includes(d.name));
            });

            if (matchedDept) {
              el.setAttribute('title', `Click to drill down into ${matchedDept.name} (${matchedDept.count} students)`);
              const clickFn = (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                handleSelectDepartment(matchedDept);
              };

              el.onclick = clickFn;
              el.querySelectorAll('*').forEach(child => {
                const childEl = child as HTMLElement;
                childEl.style.cursor = 'pointer';
                childEl.onclick = clickFn;
              });
            }
          });
        }
      } catch (renderErr) {
        console.error('Mermaid render failure:', renderErr);
        if (isMounted) {
          setMermaidError(true);
        }
      } finally {
        if (isMounted) {
          setIsMermaidRendering(false);
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [overview, selectedDept, viewMode, isOpen]);

  // Event delegation click handler for the entire Mermaid container
  const handleDiagramClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!overview || !overview.departments) return;
    const target = e.target as HTMLElement;
    if (!target) return;

    // Find closest node group or label container
    const nodeEl = target.closest('.node');
    if (!nodeEl) return;

    const elId = nodeEl.id || '';
    const elText = (nodeEl.textContent || '').trim();

    // Ignore root SNIST node
    if (elId.toLowerCase().includes('snist') || elText.toLowerCase().includes('sreenidhi institute')) {
      return;
    }

    // Sort departments by code length descending so longer codes (e.g. CSE-CS) match before substrings (e.g. CSE)
    const sortedDepts = [...overview.departments].sort((a, b) => b.code.length - a.code.length);

    // 1. Try exact ID match first
    for (const d of sortedDepts) {
      const nodeId = `dept_${d.id < 0 ? 'unassigned' : d.id}`;
      if (elId.includes(nodeId)) {
        handleSelectDepartment(d);
        return;
      }
    }

    // 2. Try text content match (longer code first)
    for (const d of sortedDepts) {
      if (elText.includes(d.code)) {
        handleSelectDepartment(d);
        return;
      }
    }

    // 3. Try department name match
    for (const d of sortedDepts) {
      if (d.name && elText.includes(d.name)) {
        handleSelectDepartment(d);
        return;
      }
    }
  };

  // Level 2 Drill-down: Fetch department students roster lazily
  const handleSelectDepartment = async (dept: DepartmentMetric) => {
    setSelectedDept(dept);
    setIsStudentsLoading(true);
    setStudentsError(null);
    setSearchTerm('');
    setFilterPresence('ALL');
    setExpandedStudentId(null);

    try {
      const data = await apiRequest<StudentRosterItem[]>(`/admin/analytics/enrollment/students?dept_id=${dept.id}`);
      setStudents(data);
    } catch (err: any) {
      console.error('Error fetching students roster:', err);
      setStudentsError(err.message || 'Failed to load department student roster.');
    } finally {
      setIsStudentsLoading(false);
    }
  };

  const handleBackToHierarchy = () => {
    setSelectedDept(null);
    setStudents([]);
    setSearchTerm('');
  };

  // Student filtering & sorting logic
  const filteredStudents = students.filter(s => {
    const matchesSearch = 
      s.roll_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.section_name.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (filterPresence === 'PRESENT') return s.present_today === true;
    if (filterPresence === 'ABSENT') return s.present_today === false;
    if (filterPresence === 'BOUND') return s.device_bound === true;
    if (filterPresence === 'UNBOUND') return s.device_bound === false;

    return true;
  }).sort((a, b) => {
    let comparison = 0;
    if (sortField === 'roll_number') {
      comparison = a.roll_number.localeCompare(b.roll_number);
    } else if (sortField === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (sortField === 'section_name') {
      comparison = a.section_name.localeCompare(b.section_name);
    } else if (sortField === 'percentage') {
      comparison = a.attendance_summary.attendance_percentage - b.attendance_summary.attendance_percentage;
    }
    return sortAsc ? comparison : -comparison;
  });

  const toggleSort = (field: 'roll_number' | 'name' | 'section_name' | 'percentage') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  // Math reconciliation calculation
  const sumDeptCounts = overview?.departments.reduce((sum, d) => sum + d.count, 0) || 0;
  const totalEnrolled = overview?.total_enrolled || 0;
  const isMathReconciled = sumDeptCounts === totalEnrolled;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white border border-slate-300 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header with Institutional Branding & Breadcrumbs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-[#001e40] text-white border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-blue-300 shadow-inner">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold text-white tracking-tight">
                  Institutional Enrollment Analytics
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono border border-blue-400/30">
                  READ-ONLY
                </span>
              </div>
              
              {/* Breadcrumb Navigation */}
              <div className="flex items-center gap-1.5 text-xs text-blue-200 mt-1 font-medium">
                <span 
                  onClick={handleBackToHierarchy}
                  className={`transition ${selectedDept ? 'cursor-pointer hover:text-white underline underline-offset-2' : 'text-blue-100 font-semibold'}`}
                >
                  Sreenidhi Hierarchy ({totalEnrolled} Students)
                </span>
                {selectedDept && (
                  <>
                    <span className="text-blue-400">/</span>
                    <span className="text-white font-bold bg-white/10 px-2 py-0.5 rounded">
                      {selectedDept.code} — {selectedDept.name} ({selectedDept.count})
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons & Close */}
          <div className="flex items-center gap-2">
            {selectedDept && (
              <button
                onClick={handleBackToHierarchy}
                className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" /> Back to Diagram
              </button>
            )}

            {!selectedDept && (
              <div className="flex items-center bg-white/10 p-1 rounded-xl border border-white/20">
                <button
                  onClick={() => setViewMode('DIAGRAM')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                    viewMode === 'DIAGRAM' ? 'bg-[#2f53d7] text-white shadow-sm' : 'text-blue-200 hover:text-white'
                  }`}
                >
                  <PieChart className="w-3.5 h-3.5" /> Mermaid
                </button>
                <button
                  onClick={() => setViewMode('TABLE')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                    viewMode === 'TABLE' ? 'bg-[#2f53d7] text-white shadow-sm' : 'text-blue-200 hover:text-white'
                  }`}
                >
                  <TableIcon className="w-3.5 h-3.5" /> Table
                </button>
              </div>
            )}

            <button
              onClick={() => {
                if (selectedDept) {
                  handleSelectDepartment(selectedDept);
                } else {
                  fetchOverview();
                }
              }}
              title="Refresh Data"
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition border border-white/20"
            >
              <RefreshCw className={`w-4 h-4 ${(isOverviewLoading || isStudentsLoading) ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition border border-white/20"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6 space-y-6">

          {/* ========================================================= */}
          {/* LEVEL 1: DEPARTMENT STRUCTURE OVERVIEW                    */}
          {/* ========================================================= */}
          {!selectedDept && (
            <div className="space-y-6">
              
              {/* Math Reconciliation & Summary Badge */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isMathReconciled ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    {isMathReconciled ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wide">Mathematical Reconciliation:</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isMathReconciled ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                        {isMathReconciled ? '100% RECONCILED' : 'DISCREPANCY DETECTED'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Sum of departments (<b>{sumDeptCounts}</b>) {isMathReconciled ? '==' : '!='} Stat card total (<b>{totalEnrolled}</b> enrolled students)
                    </p>
                  </div>
                </div>

                <div className="text-xs text-slate-500 font-medium bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                  Tip: Click any department node or table row to drill down into student records.
                </div>
              </div>

              {/* Loading State */}
              {isOverviewLoading && (
                <div className="py-20 flex flex-col items-center justify-center text-slate-500 space-y-3">
                  <RefreshCw className="w-8 h-8 animate-spin text-[#2f53d7]" />
                  <p className="text-sm font-semibold">Loading department hierarchy from live database...</p>
                </div>
              )}

              {/* Error State */}
              {overviewError && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
                  <span>{overviewError}</span>
                </div>
              )}

              {/* MERMAID DIAGRAM VIEW */}
              {!isOverviewLoading && overview && viewMode === 'DIAGRAM' && (
                <div className="space-y-4">
                  {/* Legend */}
                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200 shadow-sm gap-2">
                    <span className="font-bold text-slate-700 uppercase tracking-wider">Department Size Proportion:</span>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded bg-emerald-100 border-2 border-emerald-600"></span>
                        <span>Large (&ge;20%)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded bg-sky-100 border-2 border-sky-600"></span>
                        <span>Medium (10% - 20%)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded bg-amber-100 border-2 border-amber-600"></span>
                        <span>Small (&lt;10%)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded bg-slate-100 border-2 border-slate-500 border-dashed"></span>
                        <span>Unassigned</span>
                      </div>
                    </div>
                  </div>

                  {/* Mermaid SVG Container or Fallback Notice */}
                  {mermaidError ? (
                    <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 space-y-2">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <AlertCircle className="w-5 h-5 text-amber-600" />
                        Diagram Rendering Fallback
                      </div>
                      <p className="text-xs text-amber-800">
                        The interactive flowchart could not be rendered in this environment. Showing graceful department summary table below.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm overflow-x-auto min-h-[360px] flex items-center justify-center">
                      {isMermaidRendering && (
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 py-16">
                          <RefreshCw className="w-4 h-4 animate-spin text-[#2f53d7]" />
                          Rendering interactive diagram...
                        </div>
                      )}
                      <div 
                        ref={mermaidContainerRef} 
                        onClick={handleDiagramClick}
                        className={`w-full flex justify-center cursor-pointer ${isMermaidRendering ? 'hidden' : ''}`}
                      />
                    </div>
                  )}

                  {/* Quick Select Department Pills Bar */}
                  {!mermaidError && overview && (
                    <div className="flex flex-wrap items-center gap-2 p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
                      <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider shrink-0 flex items-center gap-1.5 mr-1">
                        <Users className="w-3.5 h-3.5 text-[#2f53d7]" />
                        Quick Drill-Down:
                      </span>
                      {overview.departments.map(d => {
                        const isMajor = d.count > 0;
                        return (
                          <button
                            key={d.id}
                            onClick={() => handleSelectDepartment(d)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 hover:scale-[1.02] shadow-xs cursor-pointer ${
                              (d.share_pct ?? d.percentage ?? 0) >= 20 
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 hover:border-emerald-400' 
                                : (d.share_pct ?? d.percentage ?? 0) >= 10 
                                ? 'bg-sky-50 text-sky-800 border-sky-300 hover:bg-sky-100 hover:border-sky-400' 
                                : isMajor 
                                ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100 hover:border-amber-400' 
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                            }`}
                          >
                            <span>{d.code}</span>
                            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                              isMajor ? 'bg-white/90 text-slate-800 shadow-xs border border-slate-200' : 'bg-slate-200/80 text-slate-600'
                            }`}>
                              {d.count}
                            </span>
                            <span className="text-[10px] text-slate-400 font-semibold">&rarr;</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* DEPARTMENT BREAKDOWN TABLE (Fallback or Explicit Table View) */}
              {!isOverviewLoading && overview && (viewMode === 'TABLE' || mermaidError) && (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Department Roster Breakdown ({overview.departments.length} Units)
                    </span>
                    <span className="text-xs text-slate-500">
                      Total: {overview.total_enrolled} Students
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-700">
                      <thead className="bg-slate-100 text-slate-600 uppercase font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">Code</th>
                          <th className="px-4 py-3">Department Name</th>
                          <th className="px-4 py-3 text-right">Enrolled Count</th>
                          <th className="px-4 py-3">Student Share</th>
                          <th className="px-4 py-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {overview.departments.map(dept => (
                          <tr 
                            key={dept.id} 
                            onClick={() => handleSelectDepartment(dept)}
                            className="hover:bg-blue-50/50 cursor-pointer transition"
                          >
                            <td className="px-4 py-3.5 font-mono font-bold text-[#15347e]">
                              {dept.code}
                            </td>
                            <td className="px-4 py-3.5 font-medium text-slate-800">
                              {dept.name}
                            </td>
                            <td className="px-4 py-3.5 text-right font-extrabold text-slate-900">
                              {dept.count}
                            </td>
                            <td className="px-4 py-3.5 w-48">
                              <div className="space-y-1">
                                <div className="flex justify-between text-[11px] font-bold text-slate-600">
                                  <span>{dept.share_pct}%</span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                  <div 
                                    className={`h-2 rounded-full ${
                                      dept.share_pct >= 20 ? 'bg-emerald-500' : 
                                      dept.share_pct >= 10 ? 'bg-sky-500' : 'bg-amber-500'
                                    }`}
                                    style={{ width: `${Math.min(dept.share_pct, 100)}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectDepartment(dept);
                                }}
                                className="px-3 py-1 bg-[#2f53d7]/10 hover:bg-[#2f53d7] text-[#2f53d7] hover:text-white rounded-lg text-xs font-bold transition"
                              >
                                View Roster &rarr;
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* LEVEL 2: LIVE STUDENT ROSTER PANEL                        */}
          {/* ========================================================= */}
          {selectedDept && (
            <div className="space-y-5">
              
              {/* Department Header Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#2f53d7]/10 text-[#2f53d7] border border-[#2f53d7]/20 text-xs font-extrabold">
                      {selectedDept.code}
                    </span>
                    <h3 className="text-base font-extrabold text-[#15347e]">
                      {selectedDept.name}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Showing real-time student enrollment roster with hardware device binding &amp; daily attendance status.
                  </p>
                </div>

                {/* Quick KPI stats for this department */}
                <div className="flex items-center gap-4">
                  <div className="text-center px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Enrolled</span>
                    <p className="text-lg font-extrabold text-slate-800">{students.length}</p>
                  </div>
                  <div className="text-center px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <span className="text-[10px] font-bold text-emerald-700 uppercase">Present Today</span>
                    <p className="text-lg font-extrabold text-emerald-700">
                      {students.filter(s => s.present_today).length}
                    </p>
                  </div>
                  <div className="text-center px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
                    <span className="text-[10px] font-bold text-[#2f53d7] uppercase">Device Bound</span>
                    <p className="text-lg font-extrabold text-[#2f53d7]">
                      {students.filter(s => s.device_bound).length}
                    </p>
                  </div>
                </div>
              </div>

              {/* Roster Controls: Search & Filter Pills */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                
                {/* Search Box */}
                <div className="relative flex-1 min-w-[240px] max-w-sm">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by Roll Number, Name, Section..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2f53d7] shadow-sm"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button
                    onClick={() => setFilterPresence('ALL')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      filterPresence === 'ALL' ? 'bg-[#2f53d7] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All ({students.length})
                  </button>
                  <button
                    onClick={() => setFilterPresence('PRESENT')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      filterPresence === 'PRESENT' ? 'bg-emerald-600 text-white shadow-sm' : 'text-emerald-700 hover:text-emerald-900'
                    }`}
                  >
                    Present Today ({students.filter(s => s.present_today).length})
                  </button>
                  <button
                    onClick={() => setFilterPresence('ABSENT')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      filterPresence === 'ABSENT' ? 'bg-rose-600 text-white shadow-sm' : 'text-rose-700 hover:text-rose-900'
                    }`}
                  >
                    Absent ({students.filter(s => !s.present_today).length})
                  </button>
                  <button
                    onClick={() => setFilterPresence('BOUND')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      filterPresence === 'BOUND' ? 'bg-blue-600 text-white shadow-sm' : 'text-blue-700 hover:text-blue-900'
                    }`}
                  >
                    Device Bound ({students.filter(s => s.device_bound).length})
                  </button>
                  <button
                    onClick={() => setFilterPresence('UNBOUND')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      filterPresence === 'UNBOUND' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-700 hover:text-amber-900'
                    }`}
                  >
                    Unbound ({students.filter(s => !s.device_bound).length})
                  </button>
                </div>
              </div>

              {/* Roster Loading */}
              {isStudentsLoading && (
                <div className="py-20 flex flex-col items-center justify-center text-slate-500 space-y-3 bg-white rounded-xl border border-slate-200">
                  <RefreshCw className="w-7 h-7 animate-spin text-[#2f53d7]" />
                  <p className="text-sm font-semibold">Loading students roster for {selectedDept.code}...</p>
                </div>
              )}

              {/* Roster Error */}
              {studentsError && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
                  <span>{studentsError}</span>
                </div>
              )}

              {/* Roster Table */}
              {!isStudentsLoading && !studentsError && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto max-h-[520px]">
                    <table className="w-full text-left text-xs text-slate-700">
                      <thead className="bg-slate-100 text-slate-600 uppercase font-bold sticky top-0 z-10 border-b border-slate-200 shadow-sm">
                        <tr>
                          <th 
                            onClick={() => toggleSort('roll_number')}
                            className="px-3.5 py-3 cursor-pointer hover:bg-slate-200 transition"
                          >
                            <div className="flex items-center gap-1">
                              Roll No
                              <ArrowUpDown className="w-3 h-3 text-slate-400" />
                            </div>
                          </th>
                          <th 
                            onClick={() => toggleSort('name')}
                            className="px-3.5 py-3 cursor-pointer hover:bg-slate-200 transition"
                          >
                            <div className="flex items-center gap-1">
                              Student Name
                              <ArrowUpDown className="w-3 h-3 text-slate-400" />
                            </div>
                          </th>
                          <th 
                            onClick={() => toggleSort('section_name')}
                            className="px-3 py-3 cursor-pointer hover:bg-slate-200 transition"
                          >
                            <div className="flex items-center gap-1">
                              Sec
                              <ArrowUpDown className="w-3 h-3 text-slate-400" />
                            </div>
                          </th>
                          <th 
                            onClick={() => toggleSort('percentage')}
                            className="px-3.5 py-3 text-right cursor-pointer hover:bg-slate-200 transition"
                          >
                            <div className="flex items-center justify-end gap-1">
                              Aggregate %
                              <ArrowUpDown className="w-3 h-3 text-slate-400" />
                            </div>
                          </th>
                          <th className="px-3 py-3 text-center">JNTUH Band</th>
                          <th className="px-3 py-3 text-center">Courses &lt; 75%</th>
                          <th className="px-3 py-3 text-center">Device</th>
                          <th className="px-3 py-3 text-center">Today</th>
                          <th className="px-3 py-3 text-center">Audit</th>
                          <th className="px-3 py-3 text-center">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredStudents.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="px-4 py-12 text-center text-slate-400">
                              No students found matching current search/filter criteria.
                            </td>
                          </tr>
                        ) : (
                          filteredStudents.map(student => {
                            const isExpanded = expandedStudentId === student.id;
                            const attPct = student.attendance_percentage ?? student.attendance_summary.attendance_percentage ?? 0;
                            const displayPct = student.display_percentage || student.attendance_summary.display_percentage || (attPct ? `${attPct.toFixed(1)}%` : '—');
                            const band = student.band || student.attendance_summary.band || (attPct >= 75 ? 'ELIGIBLE' : attPct >= 65 ? 'CONDONABLE' : 'DETAINED');
                            const coursesBelow75 = student.courses_below_75_count ?? student.attendance_summary.courses_below_75_count ?? (attPct < 75 ? 1 : 0);
                            const isEligible = band === 'ELIGIBLE';
                            const isCondonable = band === 'CONDONABLE';

                            return (
                              <React.Fragment key={student.id}>
                                <tr 
                                  onClick={() => setExpandedStudentId(isExpanded ? null : student.id)}
                                  className={`hover:bg-blue-50/50 cursor-pointer transition ${isExpanded ? 'bg-blue-50/70' : ''}`}
                                >
                                  {/* Roll Number */}
                                  <td className="px-3.5 py-3 font-mono font-bold text-[#15347e]">
                                    {student.roll_number}
                                  </td>

                                  {/* Student Name */}
                                  <td className="px-3.5 py-3 font-semibold text-slate-900">
                                    {student.name}
                                  </td>

                                  {/* Section */}
                                  <td className="px-3 py-3">
                                    <span className="px-2 py-0.5 rounded bg-slate-100 font-mono text-[11px] font-bold text-slate-700 border border-slate-200">
                                      {student.section_name}
                                    </span>
                                  </td>

                                  {/* Aggregate Percentage (Clickable for Raw Audit) */}
                                  <td className="px-3.5 py-3 text-right">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAuditRollNumber(student.roll_number);
                                        setIsAuditModalOpen(true);
                                      }}
                                      className={`font-mono font-black text-xs hover:underline cursor-pointer ${
                                        isEligible ? 'text-emerald-700' : isCondonable ? 'text-amber-700' : 'text-rose-700'
                                      }`}
                                      title="Click to view underlying sessions"
                                    >
                                      {displayPct}
                                    </button>
                                  </td>

                                  {/* JNTUH Band */}
                                  <td className="px-3 py-3 text-center">
                                    {isEligible ? (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                                        ELIGIBLE
                                      </span>
                                    ) : isCondonable ? (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                                        CONDONABLE
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300">
                                        DETAINED
                                      </span>
                                    )}
                                  </td>

                                  {/* Courses Below 75% */}
                                  <td className="px-3 py-3 text-center">
                                    <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                                      coursesBelow75 > 0 ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
                                    }`}>
                                      {coursesBelow75} {coursesBelow75 === 1 ? 'course' : 'courses'}
                                    </span>
                                  </td>

                                  {/* Device Bound Status */}
                                  <td className="px-3 py-3 text-center">
                                    {student.device_bound ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Bound
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                        <XCircle className="w-3 h-3 text-slate-400" /> No Lock
                                      </span>
                                    )}
                                  </td>

                                  {/* Present Today Status */}
                                  <td className="px-3 py-3 text-center">
                                    {student.present_today ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                        <UserCheck className="w-3 h-3 text-emerald-600" /> Present
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                                        &mdash; Absent
                                      </span>
                                    )}
                                  </td>

                                  {/* Direct Raw Audit Button */}
                                  <td className="px-3 py-3 text-center">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAuditRollNumber(student.roll_number);
                                        setIsAuditModalOpen(true);
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-[#001e40] hover:text-white text-[#001e40] font-bold text-[11px] border border-slate-300 shadow-xs transition flex items-center gap-1 mx-auto"
                                      title="Open JNTUH R25 session audit register"
                                    >
                                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Audit
                                    </button>
                                  </td>

                                  {/* Expand Toggle */}
                                  <td className="px-3 py-3 text-center">
                                    <button 
                                      className="p-1 rounded hover:bg-slate-200 text-slate-500 transition"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedStudentId(isExpanded ? null : student.id);
                                      }}
                                    >
                                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </button>
                                  </td>
                                </tr>

                                {/* Expandable Telemetry & Device Detail Row */}
                                {isExpanded && (
                                  <tr className="bg-slate-50 border-y border-blue-100">
                                    <td colSpan={10} className="px-6 py-4">
                                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                                        
                                        {/* Box 1: Device & Security */}
                                        <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5 shadow-sm">
                                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                                            <Smartphone className="w-4 h-4 text-[#2f53d7]" />
                                            <span>Hardware Device Binding</span>
                                          </div>
                                          <div className="space-y-1 text-slate-600 text-[11px]">
                                            <div>Status: <b>{student.device_bound ? 'Locked to Device' : 'No Hardware Lock'}</b></div>
                                            <div>Device ID: <span className="font-mono">{student.registered_device_id ?? 'None'}</span></div>
                                            <div>Anti-Proxy Lockout: <span className="text-emerald-600 font-bold">Enforced (30m lock)</span></div>
                                          </div>
                                        </div>

                                        {/* Box 2: Attendance Sessions */}
                                        <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5 shadow-sm">
                                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                                            <ShieldCheck className="w-4 h-4 text-emerald-600" />
                                            <span>Attendance Telemetry</span>
                                          </div>
                                          <div className="space-y-1 text-slate-600 text-[11px]">
                                            <div>Sessions Attended: <b>{student.attendance_summary.attended_sessions}</b></div>
                                            <div>Total Class Sessions: <b>{student.attendance_summary.total_sessions}</b></div>
                                            <div>Overall Standing: <b className={attPct >= 75 ? 'text-emerald-600' : 'text-rose-600'}>{displayPct}</b></div>
                                          </div>
                                        </div>

                                        {/* Box 3: JNTUH Compliance Details */}
                                        <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5 shadow-sm">
                                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                                            <FileText className="w-4 h-4 text-amber-600" />
                                            <span>JNTUH R25 Details</span>
                                          </div>
                                          <div className="space-y-1 text-slate-600 text-[11px]">
                                            <div>Band: <b className="uppercase">{band}</b></div>
                                            <div>Courses &lt; 75%: <b>{coursesBelow75}</b></div>
                                            <div>Condonation: <b className="uppercase">{student.condonation_status || 'Pending'}</b></div>
                                            {student.join_date && <div>Joined: <span className="font-mono text-blue-600">{student.join_date}</span></div>}
                                          </div>
                                        </div>

                                        {/* Box 4: Action Drawer */}
                                        <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2 shadow-sm flex flex-col justify-between">
                                          <div className="space-y-1 text-slate-600 text-[11px]">
                                            <div className="font-bold text-slate-800">Session Traceability</div>
                                            <div>Inspect individual lecture credits and scan timestamps.</div>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setAuditRollNumber(student.roll_number);
                                              setIsAuditModalOpen(true);
                                            }}
                                            className="w-full py-2 bg-[#001e40] hover:bg-[#003366] text-white font-bold rounded-lg text-xs transition flex items-center justify-center gap-1 shadow-sm"
                                          >
                                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" /> Open Raw Sessions
                                          </button>
                                        </div>

                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Table Footer */}
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-500">
                    <span>
                      Showing {filteredStudents.length} of {students.length} students enrolled in {selectedDept.code}
                    </span>
                    <span className="font-medium">
                      SNIST Server-Authoritative IST Attendance
                    </span>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

      </div>

      {/* Raw Session Audit Trail Modal */}
      {auditRollNumber && (
        <RawSessionAuditModal
          isOpen={isAuditModalOpen}
          onClose={() => {
            setIsAuditModalOpen(false);
            setAuditRollNumber(null);
          }}
          rollNumber={auditRollNumber}
        />
      )}
    </div>
  );
};
