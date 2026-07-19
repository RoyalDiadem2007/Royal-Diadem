/**
 * Client for mentor-sessions (SXU "Your people"): the student's 1:1 asks —
 * she proposes up to three preferred windows, staff confirm the real time
 * through the admin queue.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export const SESSION_SLOTS = ['morning', 'afternoon', 'after_school', 'evening'] as const;
export type SessionSlot = (typeof SESSION_SLOTS)[number];

export const SESSION_SLOT_LABELS: Readonly<Record<SessionSlot, string>> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  after_school: 'After school',
  evening: 'Evening',
};

export type SessionWindow = { date: string; slot: SessionSlot };

export type SessionStatus = 'pending' | 'confirmed' | 'declined';

export type SessionRequest = {
  id: string;
  status: SessionStatus;
  preferredWindows: SessionWindow[];
  scheduledDate: string | null;
  scheduledTime: string | null;
  endTime: string | null;
  createdAt: string;
};

export function isSessionSlot(value: unknown): value is SessionSlot {
  return typeof value === 'string' && (SESSION_SLOTS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is SessionStatus {
  return value === 'pending' || value === 'confirmed' || value === 'declined';
}

function nullableString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new Error('session request is malformed');
  }
  return value;
}

function parseWindows(raw: unknown): SessionWindow[] {
  if (!Array.isArray(raw)) {
    throw new Error('session request is malformed');
  }
  return raw.map((entry) => {
    const record = entry as Record<string, unknown>;
    if (typeof record.date !== 'string' || !isSessionSlot(record.slot)) {
      throw new Error('session request is malformed');
    }
    return { date: record.date, slot: record.slot };
  });
}

function parseRequests(raw: unknown): SessionRequest[] {
  if (typeof raw !== 'object' || raw === null || !('requests' in raw)) {
    throw new Error('session requests response is malformed');
  }
  const { requests } = raw;
  if (!Array.isArray(requests)) {
    throw new Error('session requests response is malformed');
  }
  return requests.map((entry) => {
    const record = entry as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      !isStatus(record.status) ||
      typeof record.createdAt !== 'string'
    ) {
      throw new Error('session request is malformed');
    }
    return {
      id: record.id,
      status: record.status,
      preferredWindows: parseWindows(record.preferredWindows),
      scheduledDate: nullableString(record.scheduledDate),
      scheduledTime: nullableString(record.scheduledTime),
      endTime: nullableString(record.endTime),
      createdAt: record.createdAt,
    };
  });
}

export async function fetchSessionRequests(
  sessionToken: string,
): Promise<ApiResult<SessionRequest[]>> {
  return callEdgeFunction('mentor-sessions', {
    method: 'GET',
    sessionToken,
    parse: parseRequests,
  });
}

function parseCreated(raw: unknown): { requestId: string } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('session request response is malformed');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.requestId !== 'string') {
    throw new Error('session request response is malformed');
  }
  return { requestId: record.requestId };
}

export async function createSessionRequest(
  sessionToken: string,
  preferredWindows: SessionWindow[],
): Promise<ApiResult<{ requestId: string }>> {
  return callEdgeFunction('mentor-sessions/request', {
    method: 'POST',
    sessionToken,
    body: { preferredWindows },
    parse: parseCreated,
  });
}
