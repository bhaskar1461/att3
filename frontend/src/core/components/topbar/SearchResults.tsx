import React from 'react';
import { Loader2, Layout, User, BookOpen, ChevronRight } from 'lucide-react';

export interface SearchResultItem {
  id: string;
  category: 'Pages' | 'Students' | 'Classes';
  title: string;
  subtitle?: string;
  badge?: string;
  path: string;
}

export interface SearchResultsProps {
  query: string;
  results: SearchResultItem[];
  isLoading: boolean;
  activeIndex: number;
  onSelect: (item: SearchResultItem) => void;
  listboxId: string;
}

export const HighlightMatch: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  if (!query || query.trim().length === 0) return <span>{text}</span>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark
            key={i}
            className="bg-indigo-500/25 text-indigo-300 font-semibold px-0.5 rounded"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
};

export const SearchResults: React.FC<SearchResultsProps> = ({
  query,
  results,
  isLoading,
  activeIndex,
  onSelect,
  listboxId,
}) => {
  if (isLoading) {
    return (
      <div className="p-4 flex items-center justify-center gap-2 text-xs text-[#9ca3af]">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
        <span>Searching roster and pages...</span>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-[#9ca3af]">
        No matches for &apos;<span className="text-white font-medium">{query}</span>&apos;
      </div>
    );
  }

  // Group by category
  const groups: { category: 'Pages' | 'Students' | 'Classes'; items: SearchResultItem[] }[] = [];
  const categories: ('Pages' | 'Students' | 'Classes')[] = ['Pages', 'Students', 'Classes'];

  categories.forEach((cat) => {
    const items = results.filter((r) => r.category === cat);
    if (items.length > 0) {
      groups.push({ category: cat, items });
    }
  });

  let globalIndexCounter = 0;

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label="Search suggestions"
      className="max-h-[380px] overflow-y-auto divide-y divide-[#2a2b31]/40 py-1"
    >
      {groups.map((group) => {
        return (
          <div key={group.category} className="py-1">
            <div className="px-3 py-1.5 text-[10px] font-bold text-[#9ca3af] uppercase tracking-wider">
              {group.category}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const currentIndex = globalIndexCounter++;
                const isSelected = activeIndex === currentIndex;

                const getIcon = () => {
                  switch (item.category) {
                    case 'Pages':
                      return <Layout className="w-3.5 h-3.5 text-indigo-400" />;
                    case 'Students':
                      return <User className="w-3.5 h-3.5 text-emerald-400" />;
                    case 'Classes':
                      return <BookOpen className="w-3.5 h-3.5 text-amber-400" />;
                  }
                };

                return (
                  <div
                    key={item.id}
                    id={`search-option-${currentIndex}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onSelect(item)}
                    className={`px-3 py-2 flex items-center justify-between cursor-pointer text-xs transition-colors ${
                      isSelected
                        ? 'bg-indigo-600/20 text-white border-l-2 border-indigo-500'
                        : 'text-slate-300 hover:bg-[#25262c] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-6 h-6 rounded-md bg-[#1e1f24] border border-[#2a2b31] flex items-center justify-center shrink-0">
                        {getIcon()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          <HighlightMatch text={item.title} query={query} />
                        </div>
                        {item.subtitle && (
                          <div className="text-[11px] text-[#9ca3af] truncate">
                            <HighlightMatch text={item.subtitle} query={query} />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {item.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e1f24] border border-[#2a2b31] text-[#9ca3af] font-mono">
                          {item.badge}
                        </span>
                      )}
                      <ChevronRight className="w-3 h-3 text-[#9ca3af]" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
