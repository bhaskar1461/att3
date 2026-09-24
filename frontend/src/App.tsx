import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login, getSafeNextDestination } from './pages/Login';

// Lazy-loaded routes to keep initial student/login bundle minimal (<150KB gzip target)
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const TeacherDashboard = React.lazy(() => import('./pages/TeacherDashboard').then(m => ({ default: m.TeacherDashboard })));
const StudentPortal = React.lazy(() => import('./pages/StudentPortal').then(m => ({ default: m.StudentPortal })));
const Management = React.lazy(() => import('./pages/Management').then(m => ({ default: m.Management })));
const Reports = React.lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const OnboardingWizard = React.lazy(() => import('./pages/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })));
const PublicQrDisplay = React.lazy(() => import('./pages/PublicQrDisplay').then(m => ({ default: m.PublicQrDisplay })));
const QrSizeTest = React.lazy(() => import('./pages/QrSizeTest').then(m => ({ default: m.QrSizeTest })));
const AttendanceLanding = React.lazy(() => import('./pages/AttendanceLanding').then(m => ({ default: m.AttendanceLanding })));

const RouteLoader: React.FC = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-[#2f53d7] border-t-transparent rounded-full animate-spin" />
      <span className="text-xs font-semibold text-slate-500">Loading module...</span>
    </div>
  </div>
);

import { useNavigate } from 'react-router-dom';
import { setAuthRedirectHandler } from './services/api';

const AuthNavigationSync: React.FC = () => {
  const navigate = useNavigate();
  React.useEffect(() => {
    setAuthRedirectHandler((url: string) => {
      navigate(url, { replace: true });
    });
    return () => setAuthRedirectHandler(null);
  }, [navigate]);
  return null;
};

const RoleBasedRedirect: React.FC = () => {
  const { user } = useAuth();
  if (!user) {
    const nextPath = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
    const nextQuery = nextPath && nextPath !== '/login' && nextPath !== '/' && !nextPath.startsWith('/login')
      ? `?next=${encodeURIComponent(nextPath)}`
      : '';
    return <Navigate to={`/login${nextQuery}`} replace />;
  }
  const safeNext = getSafeNextDestination(typeof window !== 'undefined' ? window.location.search : '', user.role);
  if (safeNext) return <Navigate to={safeNext} replace />;
  if (user.role === 'SUPER_ADMIN') return <Navigate to="/admin" replace />;
  if (user.role === 'TEACHER') return <Navigate to="/teacher" replace />;
  return <Navigate to="/student" replace />;
};

import { cleanupLegacyDeviceStorage } from './services/deviceCredential';

export const App: React.FC = () => {
  React.useEffect(() => {
    // Migration hygiene: silently clean up stale legacy soft-binding storage keys on app boot
    cleanupLegacyDeviceStorage();
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <AuthNavigationSync />
        <div className="min-h-screen bg-gradient-to-b from-[#f7f9fe] to-[#ecf1fb] text-[#17233c] flex flex-col font-sans">
          <Navbar />
          <main className="flex-1">
            <React.Suspense fallback={<RouteLoader />}>
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
                    <ProtectedRoute allowedRoles={['TEACHER']}>
                      <TeacherDashboard />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/student"
                  element={
                    <ProtectedRoute allowedRoles={['STUDENT']}>
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

                {/* Public Onboarding Route (magic link — no auth required) */}
                <Route path="/onboard" element={<OnboardingWizard />} />

                {/* Public Static Login QR Display (no auth required, projector-first view) */}
                <Route path="/qr" element={<PublicQrDisplay />} />

                {/* Faculty Classroom QR Size & Readability Calibration Tool */}
                <Route path="/qr-size-test" element={<QrSizeTest />} />

                {/* Universal Projector QR Direct Entry Route (iPhone Camera / Android / Direct Link) */}
                <Route path="/a/:launchToken" element={<AttendanceLanding />} />

                <Route path="*" element={<RoleBasedRedirect />} />
              </Routes>
            </React.Suspense>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
};
