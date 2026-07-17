/**
 * Client for student-guardian-requests (OD-19 build B): the student's side of
 * the consent ceremony — her pending guardian requests with the code she
 * chooses whether to share. Emergency grants never appear on this wire.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type GuardianRequest = {
  id: string;
  guardianName: string;
  code: string;
  expiresAt: string;
};

function parseRequests(raw: unknown): GuardianRequest[] {
  if (typeof raw !== 'object' || raw === null || !('requests' in raw)) {
    throw new Error('guardian requests response is malformed');
  }
  const { requests } = raw;
  if (!Array.isArray(requests)) {
    throw new Error('guardian requests response is malformed');
  }
  return requests.map((entry) => {
    const record = entry as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      typeof record.guardianName !== 'string' ||
      typeof record.code !== 'string' ||
      typeof record.expiresAt !== 'string'
    ) {
      throw new Error('guardian request is malformed');
    }
    return {
      id: record.id,
      guardianName: record.guardianName,
      code: record.code,
      expiresAt: record.expiresAt,
    };
  });
}

export async function fetchGuardianRequests(
  sessionToken: string,
): Promise<ApiResult<GuardianRequest[]>> {
  return callEdgeFunction('student-guardian-requests', {
    method: 'GET',
    sessionToken,
    parse: parseRequests,
  });
}
