/**
 * The app's chrome (Maria's direction 2026-07-18, SXU refresh 2026-07-19):
 * every student-facing and public page lives inside the same house — the
 * gold crown band, the brand bar with the real flamingo logo, desktop
 * navigation, an HONEST notification bell (it only ever announces things
 * that exist — pending guardian requests), the account menu holding
 * sign-out, a grounding footer, and the bottom tab bar on phones. Pages
 * supply only their content. The admin panel keeps its own file-cabinet
 * shell by design.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { brand } from '@/config/branding.config';
import { fetchGuardianRequests } from '@/lib/guardianRequests';
import { logout, useAuth } from '@/lib/authStore';

export type StudentTab = 'home' | 'journal' | 'share' | 'relax';

const TABS: readonly { tab: StudentTab; to: string; icon: string; label: string }[] = [
  { tab: 'home', to: '/', icon: '🏠', label: 'Home' },
  { tab: 'journal', to: '/journal', icon: '📖', label: 'Journal' },
  { tab: 'share', to: '/share', icon: '👑', label: 'Share' },
  { tab: 'relax', to: '/relax', icon: '🕊️', label: 'Relax' },
];

function BellIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

/** The bell speaks only when something real waits (guardian requests). */
function HonestBell({ token }: { token: string }) {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchGuardianRequests(token).then((result) => {
      if (!cancelled && result.ok) {
        setPending(result.data.length);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Link
      to="/"
      className="app-bar-bell"
      aria-label={
        pending > 0
          ? `Notifications: ${String(pending)} waiting for you`
          : 'Notifications: nothing waiting'
      }
    >
      <BellIcon />
      {pending > 0 && <span className="app-bar-bell-dot" aria-hidden="true" />}
    </Link>
  );
}

export function StudentShell({
  children,
  hideBar = false,
}: {
  children: ReactNode;
  /** The landing page's hero carries the logo itself — no double branding. */
  hideBar?: boolean;
}) {
  const session = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  // Tabs belong to the student experience (Student Mode included); the
  // public visitor and guardians see the frame without them.
  const studentSession = session !== null && session.subject.type === 'student' ? session : null;
  const firstName = studentSession?.subject.displayName.split(' ')[0] ?? '';
  const initial = firstName.slice(0, 1).toUpperCase() || '♛';

  return (
    <div className="app-frame">
      <div className="crown-band" aria-hidden="true" />
      {!hideBar && (
        <header className="app-bar">
          <Link to="/" className="app-bar-brand">
            <img src={brand.logo} alt="" className="app-bar-logo" />
            <span className="app-bar-name">{brand.name}</span>
          </Link>
          {studentSession !== null && (
            <>
              <nav className="app-bar-nav" aria-label="Primary">
                {TABS.map(({ tab, to, label }) => (
                  <NavLink
                    key={tab}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      isActive ? 'app-bar-link app-bar-link-active' : 'app-bar-link'
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </nav>
              <span className="app-bar-actions">
                <span className="app-bar-hi">Hi, {firstName}</span>
                <HonestBell token={studentSession.token} />
                <span className="account-menu-wrap">
                  <button
                    type="button"
                    className="avatar-coin avatar-coin-button"
                    aria-label="Account menu"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => {
                      setMenuOpen((open) => !open);
                    }}
                  >
                    {initial}
                  </button>
                  {menuOpen && (
                    <span className="account-menu" role="menu" aria-label="Account">
                      <span className="account-menu-name">
                        {studentSession.subject.displayName}
                      </span>
                      <Link
                        role="menuitem"
                        className="account-menu-item"
                        to="/profile"
                        onClick={() => {
                          setMenuOpen(false);
                        }}
                      >
                        My Queen Card
                      </Link>
                      <Link
                        role="menuitem"
                        className="account-menu-item"
                        to="/about"
                        onClick={() => {
                          setMenuOpen(false);
                        }}
                      >
                        About {brand.name}
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        className="account-menu-item"
                        onClick={() => {
                          void logout();
                        }}
                      >
                        Sign out
                      </button>
                    </span>
                  )}
                </span>
              </span>
            </>
          )}
        </header>
      )}

      <main
        className={
          studentSession !== null
            ? 'app-content app-content-tabbed page-glow'
            : 'app-content page-glow'
        }
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
        <span className="app-footer-credit">
          Built by {brand.builtBy.name}
          {brand.builtBy.email !== '' && (
            <>
              {' · '}
              <a className="app-footer-link" href={`mailto:${brand.builtBy.email}`}>
                {brand.builtBy.email}
              </a>
            </>
          )}
        </span>
      </footer>

      {studentSession !== null && (
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
