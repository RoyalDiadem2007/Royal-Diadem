/**
 * Client for the admin-flags Edge Function (Phase 14): the Flag Center.
 * Detail lines carry names, dates and reason categories only — contents
 * stay in their own sections.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type FlagEntityType = 'crown_check' | 'journal' | 'share_post' | 'share_comment';

export type CenterFlag = {
  id: string;
  source: 'ai' | 'peer';
  entityType: FlagEntityType;
  severity: 'low' | 'medium' | 'high';
  status: 'new' | 'reviewed' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
  adminNotes: string | null;
  studentName: string | null;
  detail: string | null;
  flaggedBy: string | null;
};

export type FlagPage = {
  flags: CenterFlag[];
  scope: 'open' | 'all';
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

function parseFlag(raw: unknown): CenterFlag {
  const r = asRecord(raw, 'flag');
  if (
    typeof r.id !== 'string' ||
    (r.source !== 'ai' && r.source !== 'peer') ||
    (r.entityType !== 'crown_check' &&
      r.entityType !== 'journal' &&
      r.entityType !== 'share_post' &&
      r.entityType !== 'share_comment') ||
    (r.severity !== 'low' && r.severity !== 'medium' && r.severity !== 'high') ||
    (r.status !== 'new' && r.status !== 'reviewed' && r.status !== 'resolved') ||
    typeof r.createdAt !== 'string' ||
    (r.resolvedAt !== null && typeof r.resolvedAt !== 'string') ||
    (r.adminNotes !== null && typeof r.adminNotes !== 'string') ||
    (r.studentName !== null && typeof r.studentName !== 'string') ||
    (r.detail !== null && typeof r.detail !== 'string') ||
    (r.flaggedBy !== null && typeof r.flaggedBy !== 'string')
  ) {
    throw new Error('flag is malformed');
  }
  return {
    id: r.id,
    source: r.source,
    entityType: r.entityType,
    severity: r.severity,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    adminNotes: r.adminNotes,
    studentName: r.studentName,
    detail: r.detail,
    flaggedBy: r.flaggedBy,
  };
}

function parsePage(raw: unknown): FlagPage {
  const r = asRecord(raw, 'flags response');
  if (
    !Array.isArray(r.flags) ||
    (r.scope !== 'open' && r.scope !== 'all') ||
    typeof r.page !== 'number' ||
    typeof r.pageSize !== 'number' ||
    typeof r.total !== 'number'
  ) {
    throw new Error('flags response is malformed');
  }
  return {
    flags: r.flags.map(parseFlag),
    scope: r.scope,
    page: r.page,
    pageSize: r.pageSize,
    total: r.total,
  };
}

export async function listFlags(
  sessionToken: string,
  scope: 'open' | 'all',
  page: number,
): Promise<ApiResult<FlagPage>> {
  return callEdgeFunction(`admin-flags?scope=${scope}&page=${String(page)}`, {
    method: 'GET',
    sessionToken,
    parse: parsePage,
  });
}

export async function updateFlag(
  sessionToken: string,
  flagId: string,
  status: 'reviewed' | 'resolved',
  note?: string,
): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-flags/update', {
    method: 'POST',
    sessionToken,
    body: { flagId, status, ...(note === undefined ? {} : { note }) },
    parse: () => null,
  });
}

/** Where each flag's full content lives — the section the row links to. */
export function sectionPathFor(entityType: FlagEntityType): string {
  if (entityType === 'crown_check') {
    return '/admin/crown-checks';
  }
  if (entityType === 'journal') {
    return '/admin/journals';
  }
  return '/admin/share';
}
