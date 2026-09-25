import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Sparkles, CheckCircle2 } from 'lucide-react';

export const SamplePage: React.FC = () => {
  return (
    <div className="p-6 space-y-6">
      <Card className="rounded-[12px] bg-[#1e1f24] border border-[#2a2b31] p-6">
        <CardHeader className="p-0 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="accent">Feature Self-Registration</Badge>
            <span className="text-xs text-[#9ca3af]">src/features/sample</span>
          </div>
          <CardTitle className="text-xl flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            Sample Extensibility Page
          </CardTitle>
          <CardDescription>
            This page is dynamically discovered and mounted via `manifest.ts` through `import.meta.glob`.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-2 space-y-3">
          <div className="p-4 rounded-lg bg-[#141416] border border-[#2a2b31] flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="text-xs text-slate-300">
              Zero edits to core route files required. All navigation entries, registered routes, and dashboard widgets auto-mount into registries.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SamplePage;
