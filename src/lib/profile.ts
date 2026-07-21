/**
 * Client for the student-profile Edge Function (SXU): the Queen Card —
 * her avatar, what she's proud of, what she's growing toward, and her
 * strengths. Private to her and authorized staff; nothing here ever
 * touches the Data API directly.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';
import { isAvatarConfig, type AvatarConfig } from '@/lib/avatarBuilder';

export type GoalStatus = 'not_started' | 'growing' | 'completed';

export type StudentGoal = {
  id: string;
  title: string;
  nextStep: string | null;
  status: GoalStatus;
  targetDate: string | null;
  completedAt: string | null;
};

export type QueenCard = {
  profile: {
    avatarKey: string | null;
    avatarConfig: AvatarConfig | null;
    proudOf: string | null;
  };
  goals: StudentGoal[];
  strengths: string[];
  strengthOptions: { key: string; label: string }[];
};

/** The gentle focus, mirrored client-side for friendly messaging. */
export const ACTIVE_GOAL_LIMIT = 3;
export const STRENGTH_LIMIT = 5;

export const GOAL_STATUS_LABELS: Readonly<Record<GoalStatus, string>> = {
  not_started: 'Not started',
  growing: 'Growing',
  completed: 'Completed',
};

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseGoal(raw: unknown): StudentGoal {
  const r = asRecord(raw, 'goal');
  if (
    typeof r.id !== 'string' ||
    typeof r.title !== 'string' ||
    (r.nextStep !== null && typeof r.nextStep !== 'string') ||
    (r.status !== 'not_started' && r.status !== 'growing' && r.status !== 'completed') ||
    (r.targetDate !== null && typeof r.targetDate !== 'string') ||
    (r.completedAt !== null && typeof r.completedAt !== 'string')
  ) {
    throw new Error('goal is malformed');
  }
  return {
    id: r.id,
    title: r.title,
    nextStep: r.nextStep,
    status: r.status,
    targetDate: r.targetDate,
    completedAt: r.completedAt,
  };
}

function parseCard(raw: unknown): QueenCard {
  const r = asRecord(raw, 'profile response');
  const profile = asRecord(r.profile, 'profile');
  if (
    (profile.avatarKey !== null && typeof profile.avatarKey !== 'string') ||
    (profile.proudOf !== null && typeof profile.proudOf !== 'string') ||
    !Array.isArray(r.goals) ||
    !Array.isArray(r.strengths) ||
    !Array.isArray(r.strengthOptions)
  ) {
    throw new Error('profile response is malformed');
  }
  return {
    profile: {
      avatarKey: profile.avatarKey,
      // Unknown/legacy shapes read as "no built avatar" rather than throwing —
      // the card falls back to the default builder state.
      avatarConfig: isAvatarConfig(profile.avatarConfig) ? profile.avatarConfig : null,
      proudOf: profile.proudOf,
    },
    goals: r.goals.map(parseGoal),
    strengths: r.strengths.map((key) => {
      if (typeof key !== 'string') {
        throw new Error('strength key is malformed');
      }
      return key;
    }),
    strengthOptions: r.strengthOptions.map((entry) => {
      const option = asRecord(entry, 'strength option');
      if (typeof option.key !== 'string' || typeof option.label !== 'string') {
        throw new Error('strength option is malformed');
      }
      return { key: option.key, label: option.label };
    }),
  };
}

export async function fetchQueenCard(sessionToken: string): Promise<ApiResult<QueenCard>> {
  return callEdgeFunction('student-profile', {
    method: 'GET',
    sessionToken,
    parse: parseCard,
  });
}

export async function saveProfile(
  sessionToken: string,
  input: { avatarKey: string | null; avatarConfig: AvatarConfig | null; proudOf: string | null },
): Promise<ApiResult<null>> {
  return callEdgeFunction('student-profile/update', {
    method: 'POST',
    sessionToken,
    body: input,
    parse: () => null,
  });
}

export async function createGoal(
  sessionToken: string,
  input: { title: string; nextStep: string | null; targetDate: string | null },
): Promise<ApiResult<null>> {
  return callEdgeFunction('student-profile/goals/create', {
    method: 'POST',
    sessionToken,
    body: input,
    parse: () => null,
  });
}

export async function updateGoal(
  sessionToken: string,
  goal: {
    id: string;
    title: string;
    nextStep: string | null;
    status: GoalStatus;
    targetDate: string | null;
  },
): Promise<ApiResult<null>> {
  return callEdgeFunction('student-profile/goals/update', {
    method: 'POST',
    sessionToken,
    body: {
      goalId: goal.id,
      title: goal.title,
      nextStep: goal.nextStep,
      status: goal.status,
      targetDate: goal.targetDate,
    },
    parse: () => null,
  });
}

export async function setStrengths(
  sessionToken: string,
  keys: readonly string[],
): Promise<ApiResult<null>> {
  return callEdgeFunction('student-profile/strengths', {
    method: 'POST',
    sessionToken,
    body: { keys: [...keys] },
    parse: () => null,
  });
}
