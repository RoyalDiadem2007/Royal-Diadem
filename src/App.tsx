import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
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
import { CrownWatermark } from '@/components/student/CrownWatermark';
import { exitStudentMode, useAuth, type AuthSession } from '@/lib/authStore';

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

/** Warm, honest, and time-aware — never "good morning" at night. */
function greetingFor(hour: number): string {
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 17) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

function StudentHome() {
  const session = useAuth();
  if (session === null) {
    return null;
  }
  return (
    <div className="app-shell">
      {session.staffMode && <StudentModeBanner />}
      <EnablePasskeyPrompt />
      <EnablePushPrompt />
      <GuardianRequestNotice />

      {/* The hero (SXU mockup, Maria 2026-07-19): the day's most important
          question, on the warm light surface, above the fold. Sign-out lives
          in the shell's account menu now. */}
      <section className="crown-hero" aria-label="Daily check-in">
        <span className="crown-hero-watermark" aria-hidden="true">
          <CrownWatermark />
        </span>
        <h1 className="crown-hero-greeting">
          {greetingFor(new Date().getHours())},{' '}
          <span className="crown-hero-name">{session.subject.displayName}</span>
        </h1>
        <p className="crown-hero-sub">Take a breath. This space is yours.</p>
        <CrownCheck />
      </section>

      <h2 className="home-section-title">
        Today for you <span aria-hidden="true">👑</span>
      </h2>
      <DailyMessage />
      <Announcements />
      <Link to="/journal" className="today-row">
        <span className="today-row-tile today-row-tile-cream" aria-hidden="true">
          📖
        </span>
        <span className="today-row-body">
          <span className="today-row-label">Journal</span>
          <span className="today-row-text">
            Write privately — what&rsquo;s in your heart today?
          </span>
        </span>
        <span className="today-row-chevron" aria-hidden="true">
          ›
        </span>
      </Link>
      <UpcomingEvents />
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
