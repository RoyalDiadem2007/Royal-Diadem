/**
 * The app's chrome (Maria's direction 2026-07-18): every student-facing and
 * public page lives inside the same house — the gold crown band across the
 * top, the brand bar, the drifting wallpaper, a grounding footer, and (for
 * signed-in students) the bottom tab bar that makes the PWA feel like a
 * real app. Pages supply only their content; the connectors live here once.
 * The admin panel keeps its own file-cabinet shell by design.
 */
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { brand } from '@/config/branding.config';
import { ShareWallpaper } from '@/components/student/ShareWallpaper';
import { useAuth } from '@/lib/authStore';

export type StudentTab = 'home' | 'journal' | 'share' | 'relax';

const TABS: readonly { tab: StudentTab; to: string; icon: string; label: string }[] = [
  { tab: 'home', to: '/', icon: '🏠', label: 'Home' },
  { tab: 'journal', to: '/journal', icon: '📖', label: 'Journal' },
  { tab: 'share', to: '/share', icon: '👑', label: 'Share' },
  { tab: 'relax', to: '/relax', icon: '🕊️', label: 'Relax' },
];

export function StudentShell({
  children,
  hideBar = false,
}: {
  children: ReactNode;
  /** The landing page's hero carries the logo itself — no double branding. */
  hideBar?: boolean;
}) {
  const session = useAuth();
  // Tabs belong to the student experience (Student Mode included); the
  // public visitor and guardians see the frame without them.
  const showTabs = session?.subject.type === 'student';
  const firstName = session?.subject.displayName.split(' ')[0] ?? '';

  return (
    <div className="app-frame">
      <div className="crown-band" aria-hidden="true" />
      <ShareWallpaper />
      {!hideBar && (
        <header className="app-bar">
          <Link to="/" className="app-bar-brand">
            <img src={brand.logo} alt="" className="app-bar-logo" />
            <span className="app-bar-name">{brand.name}</span>
          </Link>
          {session !== null && session.subject.type === 'student' && (
            <span className="app-bar-user">
              <span className="avatar-coin avatar-coin-small" aria-hidden="true">
                {firstName.slice(0, 1).toUpperCase() || '♛'}
              </span>
              {firstName}
            </span>
          )}
        </header>
      )}

      <main
        className={showTabs ? 'app-content app-content-tabbed page-glow' : 'app-content page-glow'}
      >
        {children}
      </main>

      <footer className="app-footer">
        <span className="app-footer-brand">
          <span aria-hidden="true">👑</span> {brand.name}
        </span>
        {brand.tagline !== '' && <span className="app-footer-tagline">{brand.tagline}</span>}
        <Link to="/about" className="app-footer-link">
          About {brand.name}
        </Link>
      </footer>

      {showTabs && (
        <nav className="tab-bar" aria-label="Main">
          {TABS.map(({ tab, to, icon, label }) => (
            <NavLink
              key={tab}
              to={to}
              end={to === '/'}
              className={({ isActive }) => (isActive ? 'tab-item tab-item-active' : 'tab-item')}
            >
              <span className="tab-icon" aria-hidden="true">
                {icon}
              </span>
              <span className="tab-label">{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
