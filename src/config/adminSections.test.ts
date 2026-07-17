import { describe, expect, it } from 'vitest';
import {
  ADMIN_SECTIONS,
  adminSectionUrl,
  sectionsForRole,
  type AdminRole,
} from '@/config/adminSections';

const ALL_ROLES: readonly AdminRole[] = ['super_admin', 'mentor', 'viewer'];

describe('admin section registry', () => {
  it('shows the Dashboard to every admin role', () => {
    for (const role of ALL_ROLES) {
      expect(sectionsForRole(role).some((s) => s.id === 'dashboard')).toBe(true);
    }
  });

  it('never returns a section the role is not listed on', () => {
    for (const role of ALL_ROLES) {
      for (const section of sectionsForRole(role)) {
        expect(section.roles).toContain(role);
      }
    }
  });

  it('registers unique ids and paths', () => {
    const ids = ADMIN_SECTIONS.map((s) => s.id);
    const paths = ADMIN_SECTIONS.map((s) => s.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps Students super_admin-only until mentor assignment exists (OD-6)', () => {
    const students = ADMIN_SECTIONS.find((s) => s.id === 'students');
    expect(students?.roles).toEqual(['super_admin']);
    expect(sectionsForRole('mentor').some((s) => s.id === 'students')).toBe(false);
    expect(sectionsForRole('viewer').some((s) => s.id === 'students')).toBe(false);
  });

  it('builds /admin for the index section and nested urls otherwise', () => {
    expect(adminSectionUrl({ id: 'dashboard', label: 'Dashboard', path: '', roles: [] })).toBe(
      '/admin',
    );
    expect(
      adminSectionUrl({ id: 'students', label: 'Students', path: 'students', roles: [] }),
    ).toBe('/admin/students');
  });
});
