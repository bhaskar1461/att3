// TODO-RESTYLE: native rewrite by Phase 10
import React, { useState } from 'react';
import { PageHeader } from '../../../components/dashboard/PageHeader';
import { ChartCard } from '../../../components/dashboard/ChartCard';
import { Button } from '../../../components/ui/button';
import { DepartmentEnrollmentModal } from '../../../components/admin/DepartmentEnrollmentModal';
import { Building2, Layers } from 'lucide-react';

export const LegacyDepartmentAdapter: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Hierarchy"
        description="Department structures, academic years, sections, and student allocations"
        actions={
          <Button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
          >
            <Layers className="w-4 h-4" />
            <span>Open Department Modal</span>
          </Button>
        }
      />

      <ChartCard
        title="Institutional Hierarchy"
        subtitle="Quarantined legacy department tree and enrollment breakdown"
      >
        <div className="p-8 text-center bg-[#17181c] border border-[#2a2b31] rounded-xl space-y-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h4 className="text-sm font-bold text-white">Department Drill-Down & Enrollment Explorer</h4>
            <p className="text-xs text-[#9ca3af]">
              Access department enrollment statistics, branch structures, and student lists via the quarantined explorer.
            </p>
          </div>
          <Button
            onClick={() => setIsOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
          >
            Launch Hierarchy Explorer
          </Button>
        </div>
      </ChartCard>

      <DepartmentEnrollmentModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </div>
  );
};

export default LegacyDepartmentAdapter;
