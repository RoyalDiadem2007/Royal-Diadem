import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { brand } from '@/config/branding.config';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { EnablePasskeyPrompt } from '@/components/ui/EnablePasskeyPrompt';
import { EnablePushPrompt } from '@/components/ui/EnablePushPrompt';
import { LoginScreen } from '@/components/student/LoginScreen';
import { LandingPage } from '@/components/student/LandingPage';
import { WelcomeScreen } from '@/components/student/WelcomeScreen';
import { CrownCheck } from '@/components/student/CrownCheck';
import { DailyMessage } from '@/components/student/DailyMessage';
import { Announcements } from '@/components/student/Announcements';
import { UpcomingEvents } from '@/components/student/UpcomingEvents';
import { JournalPage } from '@/components/student/JournalPage';
import { GuardianRequestNotice } from '@/components/student/GuardianRequestNotice';
import { SharePage } from '@/components/student/SharePage';
import { RelaxPage } from '@/components/student/RelaxPage';
import { GuardianHome } from '@/components/guardian/GuardianHome';
import { GuardianLoginScreen } from '@/components/guardian/GuardianLoginScreen';
import { DashboardPage } from '@/components/admin/DashboardPage';
import { StudentsPage } from '@/components/admin/StudentsPage';
import { CrownChecksPage } from '@/components/admin/CrownChecksPage';
import { JournalsPage } from '@/components/admin/JournalsPage';
import { EncouragementPage } from '@/components/admin/EncouragementPage';
import { CalendarPage } from '@/components/admin/CalendarPage';
import { AnnouncementsPage } from '@/components/admin/AnnouncementsPage';
import { ShareModerationPage } from '@/components/admin/ShareModerationPage';
import { RelaxationPage } from '@/components/admin/RelaxationPage';
import { AdminLayout } from '@/layouts/AdminLayout';
import { exitStudentMode, logout, useAuth, type AuthSession } from '@/lib/authStore';

/**
 * Shown only during an admin's Student Mode session: names the mode plainly
 * so staff activity can never be mistaken for (or mixed into) a real
 * student's account, and carries the way back to the admin panel.
 */
function StudentModeBanner() {
  return (
    <div className="staff-mode-banner" role="status">
      <p className="staff-mode-banner-text">
        <strong>Student Mode.</strong> This is your own space in the student experience — check in
        and journal right along with the girls. Everything you save is yours, never a real
        student&apos;s.
      </p>
      <button
        type="button"
        className="staff-mode-exit"
        onClick={() => {
          void exitStudentMode();
        }}
      >
        Back to admin panel
      </button>
    </div>
  );
}

function StudentHome() {
  const session = useAuth();
  if (session === null) {
    return null;
  }
  return (
    <div className="app-shell">
      {session.staffMode && <StudentModeBanner />}
      <header className="app-header">
        <img src={brand.logo} alt={`${brand.name} logo`} className="app-logo" />
        <h1 className="app-title">
          Welcome, <span className="app-title-accent">{session.subject.displayName}</span>
        </h1>
        {brand.tagline !== '' && <p className="app-tagline">{brand.tagline}</p>}
      </header>
      <EnablePasskeyPrompt />
      <EnablePushPrompt />
      <GuardianRequestNotice />
      <DailyMessage />
      <Announcements />
      <CrownCheck />
      <nav className="door-grid" aria-label="Your spaces">
        <Link to="/journal" className="door-card">
          <span className="door-title">
            <span aria-hidden="true">📖</span> My Journal
          </span>
          <span className="door-sub">Write what&rsquo;s in your heart</span>
        </Link>
        <Link to="/share" className="door-card">
          <span className="door-title">
            <span aria-hidden="true">👑</span> Royal Diadem Share
          </span>
          <span className="door-sub">Celebrate each other</span>
        </Link>
        <Link to="/relax" className="door-card">
          <span className="door-title">
            <span aria-hidden="true">🕊️</span> Relax
          </span>
          <span className="door-sub">Breathe, ground, be still</span>
        </Link>
      </nav>
      <UpcomingEvents />
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
  if (session.subject.type === 'guardian') {
    // The portal is the guardian's entire surface; every path lands there.
    return (
      <Routes>
        <Route path="*" element={<GuardianHome />} />
      </Routes>
    );
  }
  const isAdmin = session.subject.type === 'admin';
  return (
    <Routes>
      <Route path="/" element={isAdmin ? <Navigate to="/admin" replace /> : <StudentHome />} />
      {!isAdmin && <Route path="/share" element={<SharePage />} />}
      {!isAdmin && <Route path="/journal" element={<JournalPage />} />}
      {!isAdmin && <Route path="/relax" element={<RelaxPage />} />}
      {isAdmin && (
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="crown-checks" element={<CrownChecksPage />} />
          <Route path="journals" element={<JournalsPage />} />
          <Route path="encouragement" element={<EncouragementPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="share" element={<ShareModerationPage />} />
          <Route path="relaxation" element={<RelaxationPage />} />
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
            {/* The public front door (OD-20): landing → arrow → sign-in. */}
            <Route path="/" element={<LandingPage />} />
            {/* Emailed magic links land here (OD-19). */}
            <Route path="/welcome" element={<WelcomeScreen />} />
            {/* Guardian portal sign-in (OD-19 build B). */}
            <Route path="/guardian" element={<GuardianLoginScreen />} />
            {/* /login and any deep link (e.g. /admin) go to sign-in. */}
            <Route path="*" element={<LoginScreen />} />
          </Routes>
        ) : (
          <AuthedRoutes session={session} />
        )}
      </BrowserRouter>
    </ErrorBoundary>
  );
}
