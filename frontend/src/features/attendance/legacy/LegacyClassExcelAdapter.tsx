// TODO-RESTYLE: native rewrite by Phase 10
import React, { useState } from 'react';
import { PageHeader } from '../../../components/dashboard/PageHeader';
import { ChartCard } from '../../../components/dashboard/ChartCard';
import { Button } from '../../../components/ui/button';
import { ClassExcelRegisterModal } from '../../../components/ClassExcelRegisterModal';
import { FileSpreadsheet, Table } from 'lucide-react';

export const LegacyClassExcelAdapter: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class Master Excel Register"
        description="Official tabular matrix register with daily period check-in columns"
        actions={
          <Button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
          >
            <Table className="w-4 h-4" />
            <span>Open Register Modal</span>
          </Button>
        }
      />

      <ChartCard
        title="Official Matrix Register"
        subtitle="Quarantined legacy excel grid viewer and live period-by-period matrix"
      >
        <div className="p-8 text-center bg-[#17181c] border border-[#2a2b31] rounded-xl space-y-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h4 className="text-sm font-bold text-white">Full-Sheet Attendance Matrix Explorer</h4>
            <p className="text-xs text-[#9ca3af]">
              View multi-column day-by-day attendance records, calculate totals, and filter critical attendance students.
            </p>
          </div>
          <Button
            onClick={() => setIsOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            Launch Matrix Viewer
          </Button>
        </div>
      </ChartCard>

      <ClassExcelRegisterModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </div>
  );
};

export default LegacyClassExcelAdapter;
