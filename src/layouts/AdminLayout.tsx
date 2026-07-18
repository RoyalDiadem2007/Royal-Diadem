/**
 * Desktop "file cabinet" admin shell (Spec §6.10): full-screen layout, left
 * sidebar of role-visible sections, main content via the router outlet.
 * Rendered only under the /admin route guard; the null return below is the
 * type-level backstop, not the security boundary (that's server-side RBAC).
 */
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { brand } from '@/config/branding.config';
import { sectionsForRole, adminSectionUrl, type AdminRole } from '@/config/adminSections';
import { enterStudentMode, logout, useAuth } from '@/lib/authStore';

const ROLE_LABELS: Readonly<Record<AdminRole, string>> = {
  super_admin: 'Super Admin',
  mentor: 'Mentor',
  viewer: 'Viewer',
};

export function AdminLayout() {
  const session = useAuth();
  const role = session?.subject.role;
  const [studentModeError, setStudentModeError] = useState<string | null>(null);
  const [enteringStudentMode, setEnteringStudentMode] = useState(false);
  if (
    session?.subject.type !== 'admin' ||
    role === undefined ||
    role === 'student' ||
    role === 'guardian'
  ) {
    return null;
  }
  const sections = sectionsForRole(role);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <img src={brand.logo} alt={`${brand.name} logo`} className="admin-logo" />
          <span className="admin-brand-name">{brand.name}</span>
        </div>
        <nav className="admin-nav" aria-label="Admin sections">
          {sections.map((section) => (
            <NavLink
              key={section.id}
              to={adminSectionUrl(section)}
              end={section.path === ''}
              className={({ isActive }) =>
                isActive ? 'admin-nav-link admin-nav-link-active' : 'admin-nav-link'
              }
            >
              {section.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-user">
          <span className="admin-user-name">{session.subject.displayName}</span>
          <span className="admin-user-role">{ROLE_LABELS[role]}</span>
          {/* Viewer is read-only; the server denies it Student Mode, so no button. */}
          {role !== 'viewer' && (
            <button
              type="button"
              className="admin-viewas-button"
              disabled={enteringStudentMode}
              onClick={() => {
                setStudentModeError(null);
                setEnteringStudentMode(true);
                void enterStudentMode().then((result) => {
                  // On success the session flips to the student subject and the
                  // router lands on the student home; this layout unmounts.
                  setEnteringStudentMode(false);
                  if (!result.ok) {
                    setStudentModeError(result.message);
                  }
                });
              }}
            >
              View as student
            </button>
          )}
          {studentModeError !== null && (
            <p role="alert" className="admin-viewas-error">
              {studentModeError}
            </p>
          )}
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
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
