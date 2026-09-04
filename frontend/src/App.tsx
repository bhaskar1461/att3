import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { ProtectedRoute } from './components/ProtectedRoute';

// Route-level code splitting for rapid mobile initial load
const Login = React.lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const TeacherDashboard = React.lazy(() => import('./pages/TeacherDashboard').then(m => ({ default: m.TeacherDashboard })));
const StudentPortal = React.lazy(() => import('./pages/StudentPortal').then(m => ({ default: m.StudentPortal })));
const Management = React.lazy(() => import('./pages/Management').then(m => ({ default: m.Management })));
const Reports = React.lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));

const PageLoader: React.FC = () => (
  <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
    <div className="w-10 h-10 border-4 border-[#15347e]/20 border-t-[#15347e] rounded-full animate-spin" />
    <span className="text-xs font-semibold tracking-wider text-[#15347e]/70 uppercase">Loading...</span>
  </div>
);

const RoleBasedRedirect: React.FC = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'SUPER_ADMIN') return <Navigate to="/admin" replace />;
  if (user.role === 'TEACHER') return <Navigate to="/teacher" replace />;
  return <Navigate to="/student" replace />;
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-gradient-to-b from-[#f7f9fe] to-[#ecf1fb] text-[#17233c] flex flex-col font-sans">
          <Navbar />
          <main className="flex-1">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<Login />} />

                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                      <AdminDashboard />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/management"
                  element={
                    <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                      <Management />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/teacher"
                  element={
                    <ProtectedRoute allowedRoles={['TEACHER', 'SUPER_ADMIN']}>
                      <TeacherDashboard />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/student"
                  element={
                    <ProtectedRoute allowedRoles={['STUDENT', 'SUPER_ADMIN']}>
                      <StudentPortal />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/reports"
                  element={
                    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'TEACHER']}>
                      <Reports />
                    </ProtectedRoute>
                  }
                />

                <Route path="*" element={<RoleBasedRedirect />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
};
