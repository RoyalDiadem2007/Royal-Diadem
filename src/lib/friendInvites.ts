/**
 * Client for friend-invites (SXU "Your people"): the student nominates a
 * friend's email; staff do the outreach from the admin queue. The address
 * only travels while the invite is pending — decided invites come back
 * scrubbed.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type InviteStatus = 'pending' | 'reached_out' | 'declined';

export type FriendInvite = {
  id: string;
  /** Present only while pending; scrubbed once staff decide. */
  email: string | null;
  status: InviteStatus;
  createdAt: string;
};

export const INVITE_STATUS_LABELS: Readonly<Record<InviteStatus, string>> = {
  pending: 'With our team',
  reached_out: 'Our team reached out',
  declined: 'Not sent this time',
};

function isStatus(value: unknown): value is InviteStatus {
  return value === 'pending' || value === 'reached_out' || value === 'declined';
}

function parseInvites(raw: unknown): FriendInvite[] {
  if (typeof raw !== 'object' || raw === null || !('invites' in raw)) {
    throw new Error('friend invites response is malformed');
  }
  const { invites } = raw;
  if (!Array.isArray(invites)) {
    throw new Error('friend invites response is malformed');
  }
  return invites.map((entry) => {
    const record = entry as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      (record.email !== null && typeof record.email !== 'string') ||
      !isStatus(record.status) ||
      typeof record.createdAt !== 'string'
    ) {
      throw new Error('friend invite is malformed');
    }
    return {
      id: record.id,
      email: record.email,
      status: record.status,
      createdAt: record.createdAt,
    };
  });
}

export async function fetchFriendInvites(sessionToken: string): Promise<ApiResult<FriendInvite[]>> {
  return callEdgeFunction('friend-invites', {
    method: 'GET',
    sessionToken,
    parse: parseInvites,
  });
}

function parseCreated(raw: unknown): { inviteId: string } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('friend invite response is malformed');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.inviteId !== 'string') {
    throw new Error('friend invite response is malformed');
  }
  return { inviteId: record.inviteId };
}

export async function createFriendInvite(
  sessionToken: string,
  email: string,
): Promise<ApiResult<{ inviteId: string }>> {
  return callEdgeFunction('friend-invites/create', {
    method: 'POST',
    sessionToken,
    body: { email },
    parse: parseCreated,
  });
}
