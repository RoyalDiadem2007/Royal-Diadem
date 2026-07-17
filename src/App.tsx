import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { brand } from '@/config/branding.config';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { EnablePasskeyPrompt } from '@/components/ui/EnablePasskeyPrompt';
import { LoginScreen } from '@/components/student/LoginScreen';
import { WelcomeScreen } from '@/components/student/WelcomeScreen';
import { CrownCheck } from '@/components/student/CrownCheck';
import { DashboardPage } from '@/components/admin/DashboardPage';
import { StudentsPage } from '@/components/admin/StudentsPage';
import { CrownChecksPage } from '@/components/admin/CrownChecksPage';
import { AdminLayout } from '@/layouts/AdminLayout';
import { logout, useAuth, type AuthSession } from '@/lib/authStore';

function StudentHome() {
  const session = useAuth();
  if (session === null) {
    return null;
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <img src={brand.logo} alt={`${brand.name} logo`} className="app-logo" />
        <h1 className="app-title">Welcome, {session.subject.displayName}</h1>
        {brand.tagline !== '' && <p className="app-tagline">{brand.tagline}</p>}
      </header>
      <EnablePasskeyPrompt />
      <CrownCheck />
      <button
        type="button"
        className="logout-button"
        onClick={() => {
          void logout();
        }}
      >
        Sign out
      </button>
    </div>
  );
}

/**
 * Routes for a signed-in user. The admin branch exists only for admin
 * sessions, so a student hitting /admin falls through to the catch-all and
 * lands home — a UX gate; the real boundary is server-side RBAC on every
 * Edge Function.
 */
function AuthedRoutes({ session }: { session: AuthSession }) {
  const isAdmin = session.subject.type === 'admin';
  return (
    <Routes>
      <Route path="/" element={isAdmin ? <Navigate to="/admin" replace /> : <StudentHome />} />
      {isAdmin && (
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="crown-checks" element={<CrownChecksPage />} />
        </Route>
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  const session = useAuth();
  return (
    <ErrorBoundary>
      <BrowserRouter>
        {session === null ? (
          <Routes>
            {/* Emailed magic links land here (OD-19); everything else signs in. */}
            <Route path="/welcome" element={<WelcomeScreen />} />
            <Route path="*" element={<LoginScreen />} />
          </Routes>
        ) : (
          <AuthedRoutes session={session} />
        )}
      </BrowserRouter>
    </ErrorBoundary>
  );
}
