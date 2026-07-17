/**
 * Admin panel section registry (Spec §6.10 — the file cabinet's drawers).
 * Sections register here as their build phases ship; the sidebar renders
 * straight from this list. `roles` is the provisional OD-12 visibility matrix
 * (PROJECT_STATE.md) and is UX only — every Edge Function re-checks the role
 * server-side regardless of what the sidebar shows.
 */

export type AdminRole = 'super_admin' | 'mentor' | 'viewer';

export type AdminSection = {
  id: string;
  label: string;
  /** Path segment under /admin ('' = the index route). */
  path: string;
  roles: readonly AdminRole[];
};

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { id: 'dashboard', label: 'Dashboard', path: '', roles: ['super_admin', 'mentor', 'viewer'] },
  // Mentors join once the assignment model exists (OD-6): they see only their
  // assigned students, which this section cannot scope yet.
  { id: 'students', label: 'Students', path: 'students', roles: ['super_admin'] },
];

export function sectionsForRole(role: AdminRole): readonly AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => section.roles.includes(role));
}

export function adminSectionUrl(section: AdminSection): string {
  return section.path === '' ? '/admin' : `/admin/${section.path}`;
}
