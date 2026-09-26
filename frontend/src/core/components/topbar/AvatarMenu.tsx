import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Calendar, LogOut, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../auth/AuthProvider';

export const AvatarMenu: React.FC = () => {
  const navigate = useNavigate();
  const { user, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Compute initials
  const initials = (() => {
    if (!user) return 'U';
    if (user.full_name) {
      const parts = user.full_name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (user.username) {
      return user.username.slice(0, 2).toUpperCase();
    }
    return 'U';
  })();

  const displayName = user?.full_name || user?.username || 'User';
  const email = user?.email || (user?.username ? `${user.username}@snist.edu.in` : '');
  const roleName = (role || 'user').toUpperCase();

  // Close on Escape or Outside Click
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleSignOut = () => {
    setOpen(false);
    logout();
    toast.success('Signed out');
    navigate('/login');
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="User profile menu"
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-xl hover:bg-[#1e1f24] border border-transparent hover:border-[#2a2b31] transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xs flex items-center justify-center shadow-sm ring-1 ring-[#2a2b31] shrink-0">
          {initials}
        </div>
        <div className="hidden lg:flex flex-col text-left leading-tight">
          <span className="text-xs font-bold text-white tracking-tight truncate max-w-[120px]">
            {displayName}
          </span>
          <span className="text-[10px] font-medium text-[#9ca3af] truncate max-w-[120px]">
            {roleName}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-[#9ca3af] transition-transform duration-200 hidden sm:block ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="User options"
          className="absolute right-0 mt-2 w-64 rounded-2xl bg-[#1e1f24] border border-[#2a2b31] shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* Header Block */}
          <div className="p-4 border-b border-[#2a2b31] bg-[#1a1b1f]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-sm flex items-center justify-center shadow-md shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white truncate">
                  {displayName}
                </p>
                {email && (
                  <p className="text-[11px] text-slate-400 truncate">
                    {email}
                  </p>
                )}
                <div className="mt-1">
                  <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {roleName}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Role-specific Navigation Items */}
          <div className="p-1.5 space-y-0.5">
            {role === 'admin' ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate('/admin/settings');
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-[#25262c] flex items-center gap-2.5 transition-colors"
              >
                <Settings className="w-4 h-4 text-slate-400" />
                Profile & settings
              </button>
            ) : role === 'teacher' ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate('/sessions/history?teacher=me');
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-[#25262c] flex items-center gap-2.5 transition-colors"
              >
                <Calendar className="w-4 h-4 text-emerald-400" />
                My sessions
              </button>
            ) : null}

            <div className="h-px bg-[#2a2b31] my-1" />

            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 flex items-center gap-2.5 transition-colors"
            >
              <LogOut className="w-4 h-4 text-rose-400" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
