/**
 * Client for admin-requests: the staff queue behind the "Your people"
 * cards — 1:1 asks waiting for a real time, friend invites waiting for
 * human outreach.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';
import { isSessionSlot, type SessionStatus, type SessionWindow } from '@/lib/mentorSessions';

export type QueueSession = {
  id: string;
  studentName: string;
  status: SessionStatus;
  preferredWindows: SessionWindow[];
  scheduledDate: string | null;
  scheduledTime: string | null;
  endTime: string | null;
  createdAt: string;
};

export type QueueInvite = {
  id: string;
  studentName: string;
  email: string | null;
  createdAt: string;
};

export type RequestsQueue = { sessions: QueueSession[]; invites: QueueInvite[] };

function isStatus(value: unknown): value is SessionStatus {
  return value === 'pending' || value === 'confirmed' || value === 'declined';
}

function nullableString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new Error('requests queue is malformed');
  }
  return value;
}

function parseWindows(raw: unknown): SessionWindow[] {
  if (!Array.isArray(raw)) {
    throw new Error('requests queue is malformed');
  }
  return raw.map((entry) => {
    const record = entry as Record<string, unknown>;
    if (typeof record.date !== 'string' || !isSessionSlot(record.slot)) {
      throw new Error('requests queue is malformed');
    }
    return { date: record.date, slot: record.slot };
  });
}

function parseSession(entry: unknown): QueueSession {
  const record = entry as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.studentName !== 'string' ||
    !isStatus(record.status) ||
    typeof record.createdAt !== 'string'
  ) {
    throw new Error('requests queue is malformed');
  }
  return {
    id: record.id,
    studentName: record.studentName,
    status: record.status,
    preferredWindows: parseWindows(record.preferredWindows),
    scheduledDate: nullableString(record.scheduledDate),
    scheduledTime: nullableString(record.scheduledTime),
    endTime: nullableString(record.endTime),
    createdAt: record.createdAt,
  };
}

function parseInvite(entry: unknown): QueueInvite {
  const record = entry as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.studentName !== 'string' ||
    (record.email !== null && typeof record.email !== 'string') ||
    typeof record.createdAt !== 'string'
  ) {
    throw new Error('requests queue is malformed');
  }
  return {
    id: record.id,
    studentName: record.studentName,
    email: record.email,
    createdAt: record.createdAt,
  };
}

function parseQueue(raw: unknown): RequestsQueue {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('requests queue is malformed');
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.sessions) || !Array.isArray(record.invites)) {
    throw new Error('requests queue is malformed');
  }
  return {
    sessions: record.sessions.map(parseSession),
    invites: record.invites.map(parseInvite),
  };
}

export async function fetchRequestsQueue(sessionToken: string): Promise<ApiResult<RequestsQueue>> {
  return callEdgeFunction('admin-requests', {
    method: 'GET',
    sessionToken,
    parse: parseQueue,
  });
}

function parseAcknowledged(key: 'declined' | 'decided') {
  return (raw: unknown): { done: true } => {
    if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>)[key] !== true) {
      throw new Error('requests response is malformed');
    }
    return { done: true };
  };
}

export async function confirmSession(
  sessionToken: string,
  requestId: string,
  schedule: { date: string; time: string; endTime: string | null },
): Promise<ApiResult<QueueSession>> {
  return callEdgeFunction('admin-requests/sessions/confirm', {
    method: 'POST',
    sessionToken,
    body: { requestId, ...schedule },
    parse: (raw: unknown): QueueSession => {
      if (typeof raw !== 'object' || raw === null || !('session' in raw)) {
        throw new Error('requests response is malformed');
      }
      return parseSession((raw as Record<string, unknown>).session);
    },
  });
}

export async function declineSession(
  sessionToken: string,
  requestId: string,
): Promise<ApiResult<{ done: true }>> {
  return callEdgeFunction('admin-requests/sessions/decline', {
    method: 'POST',
    sessionToken,
    body: { requestId },
    parse: parseAcknowledged('declined'),
  });
}

export async function decideInvite(
  sessionToken: string,
  inviteId: string,
  decision: 'reached-out' | 'decline',
): Promise<ApiResult<{ done: true }>> {
  return callEdgeFunction(`admin-requests/invites/${decision}`, {
    method: 'POST',
    sessionToken,
    body: { inviteId },
    parse: parseAcknowledged('decided'),
  });
}
