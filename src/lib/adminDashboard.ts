/**
 * Client for the admin-dashboard Edge Function. Aggregate counts only — no
 * student contents ever arrive through this call.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type DashboardCounts = {
  activeStudents: number;
  newFlags: number;
  highSeverityNewFlags: number;
  todaysCrownChecks: number;
};

function requireCount(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`dashboard count "${key}" is malformed`);
  }
  return value;
}

function parseCounts(raw: unknown): DashboardCounts {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('dashboard response is not an object');
  }
  const record = raw as Record<string, unknown>;
  return {
    activeStudents: requireCount(record, 'activeStudents'),
    newFlags: requireCount(record, 'newFlags'),
    highSeverityNewFlags: requireCount(record, 'highSeverityNewFlags'),
    todaysCrownChecks: requireCount(record, 'todaysCrownChecks'),
  };
}

export async function fetchDashboardCounts(
  sessionToken: string,
): Promise<ApiResult<DashboardCounts>> {
  return callEdgeFunction('admin-dashboard', {
    method: 'GET',
    sessionToken,
    parse: parseCounts,
  });
}
