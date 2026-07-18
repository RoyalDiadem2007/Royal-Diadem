/**
 * Client for the admin-about Edge Function (Phase 12): editing the About Us
 * page's two sections.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';
import type { AboutSection } from '@/lib/about';

export type AdminAboutSection = {
  section: AboutSection;
  title: string;
  body: string;
  updatedAt: string;
};

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseSections(raw: unknown): AdminAboutSection[] {
  const r = asRecord(raw, 'about response');
  if (!Array.isArray(r.sections)) {
    throw new Error('about response is malformed');
  }
  return r.sections.map((entry) => {
    const row = asRecord(entry, 'about section');
    if (
      (row.section !== 'about_org' && row.section !== 'pastor_bio') ||
      typeof row.title !== 'string' ||
      typeof row.body !== 'string' ||
      typeof row.updatedAt !== 'string'
    ) {
      throw new Error('about section is malformed');
    }
    return { section: row.section, title: row.title, body: row.body, updatedAt: row.updatedAt };
  });
}

export async function listAboutSections(
  sessionToken: string,
): Promise<ApiResult<AdminAboutSection[]>> {
  return callEdgeFunction('admin-about', {
    method: 'GET',
    sessionToken,
    parse: parseSections,
  });
}

export async function saveAboutSection(
  sessionToken: string,
  section: AboutSection,
  title: string,
  body: string,
): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-about/update', {
    method: 'POST',
    sessionToken,
    body: { section, title, body },
    parse: () => null,
  });
}
