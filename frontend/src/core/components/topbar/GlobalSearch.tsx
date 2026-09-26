import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Command, X } from 'lucide-react';
import { navRegistry } from '../../registries';
import { useAuth } from '../../auth/AuthProvider';
import { SearchResults, SearchResultItem } from './SearchResults';

export interface GlobalSearchProps {
  className?: string;
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ className = '' }) => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const currentRole = role || 'admin';

  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  const listboxId = 'global-search-listbox';

  // Keyboard shortcut Ctrl/Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Outside click to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const executeSearch = useCallback(
    async (searchTerm: string) => {
      const trimmed = searchTerm.trim();
      if (trimmed.length < 2) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      // Cancel previous pending network request if any
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);

      const items: SearchResultItem[] = [];

      // 1. Pages (Client-side from navRegistry)
      try {
        const navItems = navRegistry.all(currentRole);
        const lowerQ = trimmed.toLowerCase();
        const matchedNavs = navItems
          .filter(
            (n) =>
              n.label.toLowerCase().includes(lowerQ) ||
              (n.section && n.section.toLowerCase().includes(lowerQ))
          )
          .slice(0, 5)
          .map((n) => ({
            id: `page-${n.id}`,
            category: 'Pages' as const,
            title: n.label,
            subtitle: `${n.section || 'Navigation'} • ${n.path}`,
            badge: n.section,
            path: n.path,
          }));
        items.push(...matchedNavs);
      } catch (navErr) {
        console.warn('Navigation search error:', navErr);
      }

      // 2. Students (Real Roster Endpoint)
      try {
        const token =
          typeof localStorage !== 'undefined'
            ? localStorage.getItem('access_token') || localStorage.getItem('token')
            : null;
        const base = import.meta.env.VITE_API_BASE ?? '';

        const studentsRes = await fetch(
          `${base}/api/v1/admin/students?search=${encodeURIComponent(trimmed)}&page=1&page_size=5`,
          {
            signal: controller.signal,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );

        if (studentsRes.ok) {
          const data = await studentsRes.json();
          const studentList: any[] = Array.isArray(data) ? data : data.items || [];
          const studentItems: SearchResultItem[] = studentList.slice(0, 5).map((s: any) => ({
            id: `student-${s.id}`,
            category: 'Students' as const,
            title: s.name,
            subtitle: `${s.roll_number} • ${s.department || ''} ${s.section || ''}`,
            badge: s.roll_number,
            path: `/roster/students?open=${s.id}`,
          }));
          items.push(...studentItems);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('Student search error:', err);
        }
      }

      // 3. Classes / Assignments (Real Roster Endpoint)
      try {
        const token =
          typeof localStorage !== 'undefined'
            ? localStorage.getItem('access_token') || localStorage.getItem('token')
            : null;
        const base = import.meta.env.VITE_API_BASE ?? '';

        const classesRes = await fetch(`${base}/api/v1/admin/assignments`, {
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (classesRes.ok) {
          const data = await classesRes.json();
          const assignList: any[] = Array.isArray(data) ? data : data.items || [];
          const lowerQ = trimmed.toLowerCase();
          const matchedClasses = assignList
            .filter((c: any) => {
              const sub = (c.subject_name || c.subject?.name || '').toLowerCase();
              const sec = (c.section_name || c.section?.name || '').toLowerCase();
              const tch = (c.teacher_name || c.teacher?.name || '').toLowerCase();
              return sub.includes(lowerQ) || sec.includes(lowerQ) || tch.includes(lowerQ);
            })
            .slice(0, 5)
            .map((c: any) => ({
              id: `class-${c.id}`,
              category: 'Classes' as const,
              title: c.subject_name || c.subject?.name || 'Class',
              subtitle: `${c.section_name || c.section?.name || ''} • ${c.teacher_name || c.teacher?.name || ''}`,
              badge: c.section_name || c.section?.name || 'Assigned',
              path: `/roster/classes?open=${c.id}`,
            }));
          items.push(...matchedClasses);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('Class search error:', err);
        }
      }

      if (!controller.signal.aborted) {
        setResults(items);
        setIsLoading(false);
        setActiveIndex(items.length > 0 ? 0 : -1);
      }
    },
    [currentRole]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    if (val.trim().length < 2) {
      setResults([]);
      setIsLoading(false);
      setActiveIndex(-1);
      return;
    }

    setIsLoading(true);
    debounceTimerRef.current = window.setTimeout(() => {
      executeSearch(val);
    }, 250);
  };

  const handleSelect = (item: SearchResultItem) => {
    setIsOpen(false);
    setQuery('');
    navigate(item.path);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || results.length === 0) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        if (query.trim().length >= 2) {
          setIsOpen(true);
        }
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1 < results.length ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 >= 0 ? prev - 1 : results.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          handleSelect(results[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  const clearQuery = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return (
    <div ref={containerRef} className={`relative w-full max-w-md ${className}`}>
      <div className="relative w-full">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen && query.trim().length >= 2}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 ? `search-option-${activeIndex}` : undefined
          }
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            if (query.trim().length >= 2) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search students, classes, pages..."
          className="w-full h-9 pl-9 pr-20 rounded-[10px] bg-[#1e1f24] border border-[#2a2b31] text-xs text-white placeholder:text-[#9ca3af] focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
          aria-label="Global search students, classes, and pages"
        />

        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query.length > 0 && (
            <button
              type="button"
              onClick={clearQuery}
              aria-label="Clear search input"
              className="p-1 text-[#9ca3af] hover:text-white rounded"
            >
              <X className="w-3 h-3" />
            </button>
          )}

          <div
            onClick={() => inputRef.current?.focus()}
            className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-[#2a2b31] bg-[#141416] text-[10px] text-[#9ca3af] font-mono cursor-pointer select-none"
          >
            <Command className="w-2.5 h-2.5" />
            <span>K</span>
          </div>
        </div>
      </div>

      {isOpen && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#17181c] border border-[#2a2b31] rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          <SearchResults
            query={query}
            results={results}
            isLoading={isLoading}
            activeIndex={activeIndex}
            onSelect={handleSelect}
            listboxId={listboxId}
          />
        </div>
      )}
    </div>
  );
};
