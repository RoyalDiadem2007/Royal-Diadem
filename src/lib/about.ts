/**
 * About Us content read (Phase 12, Spec §6.9): genuinely public program
 * content — the org story and Pastor Kenecia's bio — straight from the Data
 * API. Missing sections mean "not written yet", never an error.
 */
import type { ApiResult } from '@/lib/api';
import { readDataApi } from '@/lib/dataApi';

export type AboutSection = 'about_org' | 'pastor_bio';

export type AboutContent = {
  section: AboutSection;
  title: string;
  body: string;
};

function parseRow(raw: unknown): AboutContent {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('about row is not an object');
  }
  const r = raw as Record<string, unknown>;
  if (
    (r.section !== 'about_org' && r.section !== 'pastor_bio') ||
    typeof r.title !== 'string' ||
    typeof r.body !== 'string'
  ) {
    throw new Error('about row is malformed');
  }
  return { section: r.section, title: r.title, body: r.body };
}

export async function fetchAboutContent(): Promise<ApiResult<AboutContent[]>> {
  return readDataApi('about_content?select=section,title,body', {
    parse: (raw) => {
      if (!Array.isArray(raw)) {
        throw new Error('about response is not an array');
      }
      return raw.map(parseRow);
    },
  });
}
