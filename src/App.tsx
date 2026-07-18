import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
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
import { AboutPage } from '@/components/student/AboutPage';
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
import { AboutAdminPage } from '@/components/admin/AboutAdminPage';
import { FlagsPage } from '@/components/admin/FlagsPage';
import { AdminLayout } from '@/layouts/AdminLayout';
import { StudentShell } from '@/components/student/StudentShell';
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
  const firstInitial = session.subject.displayName.slice(0, 1).toUpperCase() || '♛';
  return (
    <div className="app-shell">
      {session.staffMode && <StudentModeBanner />}
      <header className="app-header">
        {/* Her page opens with HER mark (Maria 2026-07-18) — the brand logo
            lives in the shell's app bar. The coin becomes her photo when
            Phase 13 profiles arrive. */}
        <span className="avatar-coin avatar-coin-hero" aria-hidden="true">
          {firstInitial}
        </span>
        <h1 className="app-title">
          Welcome, <span className="app-title-accent">{session.subject.displayName}</span>
        </h1>
      </header>
      <EnablePasskeyPrompt />
      <EnablePushPrompt />
      <GuardianRequestNotice />
      <DailyMessage />
      <Announcements />
      <CrownCheck />
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
      <Route
        path="/"
        element={
          isAdmin ? (
            <Navigate to="/admin" replace />
          ) : (
            <StudentShell>
              <StudentHome />
            </StudentShell>
          )
        }
      />
      {!isAdmin && (
        <Route
          path="/share"
          element={
            <StudentShell>
              <SharePage />
            </StudentShell>
          }
        />
      )}
      {!isAdmin && (
        <Route
          path="/journal"
          element={
            <StudentShell>
              <JournalPage />
            </StudentShell>
          }
        />
      )}
      {!isAdmin && (
        <Route
          path="/relax"
          element={
            <StudentShell>
              <RelaxPage />
            </StudentShell>
          }
        />
      )}
      {/* About stays reachable signed-in too (students and admins alike). */}
      <Route
        path="/about"
        element={
          <StudentShell>
            <AboutPage />
          </StudentShell>
        }
      />
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
          <Route path="about" element={<AboutAdminPage />} />
          <Route path="flags" element={<FlagsPage />} />
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
            {/* The public front door (OD-20): landing → arrow → sign-in.
                The hero carries the logo, so the shell's bar stays out. */}
            <Route
              path="/"
              element={
                <StudentShell hideBar>
                  <LandingPage />
                </StudentShell>
              }
            />
            {/* Emailed magic links land here (OD-19). */}
            <Route
              path="/welcome"
              element={
                <StudentShell>
                  <WelcomeScreen />
                </StudentShell>
              }
            />
            {/* Guardian portal sign-in (OD-19 build B). */}
            <Route
              path="/guardian"
              element={
                <StudentShell>
                  <GuardianLoginScreen />
                </StudentShell>
              }
            />
            {/* The public About page (Spec §6.9) — no session needed. */}
            <Route
              path="/about"
              element={
                <StudentShell>
                  <AboutPage />
                </StudentShell>
              }
            />
            {/* /login and any deep link (e.g. /admin) go to sign-in. */}
            <Route
              path="*"
              element={
                <StudentShell>
                  <LoginScreen />
                </StudentShell>
              }
            />
          </Routes>
        ) : (
          <AuthedRoutes session={session} />
        )}
      </BrowserRouter>
    </ErrorBoundary>
  );
}
