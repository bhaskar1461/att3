import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f7f9fe] flex items-center justify-center font-bold text-[#15347e]">
        Loading System...
      </div>
    );
  }

  if (!user) {
    const nextPath = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
    const nextQuery = nextPath && nextPath !== '/login' && !nextPath.startsWith('/login')
      ? `?next=${encodeURIComponent(nextPath)}`
      : '';
    return <Navigate to={`/login${nextQuery}`} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === 'SUPER_ADMIN') return <Navigate to="/overview" replace />;
    if (user.role === 'TEACHER') return <Navigate to="/teacher" replace />;
    return <Navigate to="/student" replace />;
  }

  return <>{children}</>;
};
