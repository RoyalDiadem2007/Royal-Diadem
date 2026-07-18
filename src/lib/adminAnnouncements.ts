/**
 * Client for the admin-announcements Edge Function (Phase 9): create/manage
 * announcements with read counts (real students only — staff test
 * identities never inflate the numbers).
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  priority: 'normal' | 'urgent';
  createdAt: string;
  readCount: number;
};

export type AnnouncementPage = {
  announcements: AdminAnnouncement[];
  activeStudents: number;
  page: number;
  pageSize: number;
  total: number;
};

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseAnnouncement(raw: unknown): AdminAnnouncement {
  const r = asRecord(raw, 'announcement');
  if (
    typeof r.id !== 'string' ||
    typeof r.title !== 'string' ||
    typeof r.body !== 'string' ||
    (r.priority !== 'normal' && r.priority !== 'urgent') ||
    typeof r.createdAt !== 'string' ||
    typeof r.readCount !== 'number'
  ) {
    throw new Error('announcement is malformed');
  }
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    priority: r.priority,
    createdAt: r.createdAt,
    readCount: r.readCount,
  };
}

function parsePage(raw: unknown): AnnouncementPage {
  const r = asRecord(raw, 'announcements response');
  if (
    !Array.isArray(r.announcements) ||
    typeof r.activeStudents !== 'number' ||
    typeof r.page !== 'number' ||
    typeof r.pageSize !== 'number' ||
    typeof r.total !== 'number'
  ) {
    throw new Error('announcements response is malformed');
  }
  return {
    announcements: r.announcements.map(parseAnnouncement),
    activeStudents: r.activeStudents,
    page: r.page,
    pageSize: r.pageSize,
    total: r.total,
  };
}

export async function listAnnouncements(
  sessionToken: string,
  page: number,
): Promise<ApiResult<AnnouncementPage>> {
  return callEdgeFunction(`admin-announcements?page=${String(page)}`, {
    method: 'GET',
    sessionToken,
    parse: parsePage,
  });
}

export async function createAnnouncement(
  sessionToken: string,
  input: { title: string; body: string; priority: 'normal' | 'urgent' },
): Promise<ApiResult<AdminAnnouncement>> {
  return callEdgeFunction('admin-announcements/create', {
    method: 'POST',
    sessionToken,
    body: input,
    parse: (raw) => parseAnnouncement(asRecord(raw, 'create response').announcement),
  });
}

export async function deleteAnnouncement(
  sessionToken: string,
  announcementId: string,
): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-announcements/delete', {
    method: 'POST',
    sessionToken,
    body: { announcementId },
    parse: () => null,
  });
}
