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
  // Same OD-6 rule: trend views expose per-student regulated data, so mentors
  // wait for assignment scoping.
  { id: 'crown-checks', label: 'Crown Checks', path: 'crown-checks', roles: ['super_admin'] },
  // Journal review is the most sensitive read in the app — super_admin only
  // until OD-6 mentor assignment scopes it.
  { id: 'journals', label: 'Journals', path: 'journals', roles: ['super_admin'] },
  // The AI surface stays super_admin regardless of OD-12 (Spec §6.5:
  // admin-gated; the human IS the gate).
  { id: 'encouragement', label: 'Encouragement', path: 'encouragement', roles: ['super_admin'] },
  // Program content sections: super_admin until OD-12 assigns these rights.
  { id: 'calendar', label: 'Calendar', path: 'calendar', roles: ['super_admin'] },
  { id: 'announcements', label: 'Announcements', path: 'announcements', roles: ['super_admin'] },
  // The safe-space gate (Spec §6.8): super_admin until OD-12.
  { id: 'share-moderation', label: 'Share Moderation', path: 'share', roles: ['super_admin'] },
];

export function sectionsForRole(role: AdminRole): readonly AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => section.roles.includes(role));
}

export function adminSectionUrl(section: AdminSection): string {
  return section.path === '' ? '/admin' : `/admin/${section.path}`;
}
