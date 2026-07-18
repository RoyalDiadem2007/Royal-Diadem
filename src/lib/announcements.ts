/**
 * Student announcements (Spec §6.7, Phase 9): the feed is a direct Data API
 * read (announcements are public program content; anon policy reads all
 * rows), while read receipts go through the announcement-reads Edge
 * Function — they reference the student, so the server owns that write.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';
import { readDataApi } from '@/lib/dataApi';

export type Announcement = {
  id: string;
  title: string;
  body: string;
  priority: 'normal' | 'urgent';
  createdAt: string;
};

function parseAnnouncement(raw: unknown): Announcement {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('announcement is not an object');
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.title !== 'string' ||
    typeof r.body !== 'string' ||
    (r.priority !== 'normal' && r.priority !== 'urgent') ||
    typeof r.created_at !== 'string'
  ) {
    throw new Error('announcement is malformed');
  }
  return { id: r.id, title: r.title, body: r.body, priority: r.priority, createdAt: r.created_at };
}

/** Newest first, bounded — the student feed shows the recent program news. */
export async function fetchAnnouncements(limit: number): Promise<ApiResult<Announcement[]>> {
  const query = `select=id,title,body,priority,created_at&order=created_at.desc&limit=${String(limit)}`;
  return readDataApi(`announcements?${query}`, {
    parse: (raw) => {
      if (!Array.isArray(raw)) {
        throw new Error('announcements response is not an array');
      }
      return raw.map(parseAnnouncement);
    },
  });
}

/** Marks announcements read for the signed-in student (idempotent). */
export async function markAnnouncementsRead(
  sessionToken: string,
  announcementIds: readonly string[],
): Promise<ApiResult<number>> {
  return callEdgeFunction('announcement-reads', {
    method: 'POST',
    sessionToken,
    body: { announcementIds },
    parse: (raw) => {
      if (
        typeof raw !== 'object' ||
        raw === null ||
        !('marked' in raw) ||
        typeof raw.marked !== 'number'
      ) {
        throw new Error('mark-read response is malformed');
      }
      return raw.marked;
    },
  });
}
