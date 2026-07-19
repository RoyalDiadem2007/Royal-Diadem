/**
 * Client for the admin-strengths Edge Function (SXU): curating the
 * strengths vocabulary students pick from on their Queen Cards.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type StrengthOption = { key: string; label: string; active: boolean };

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseOptions(raw: unknown): StrengthOption[] {
  const r = asRecord(raw, 'strengths response');
  if (!Array.isArray(r.options)) {
    throw new Error('strengths response is malformed');
  }
  return r.options.map((entry) => {
    const option = asRecord(entry, 'strength option');
    if (
      typeof option.key !== 'string' ||
      typeof option.label !== 'string' ||
      typeof option.active !== 'boolean'
    ) {
      throw new Error('strength option is malformed');
    }
    return { key: option.key, label: option.label, active: option.active };
  });
}

export async function listStrengthOptions(
  sessionToken: string,
): Promise<ApiResult<StrengthOption[]>> {
  return callEdgeFunction('admin-strengths', {
    method: 'GET',
    sessionToken,
    parse: parseOptions,
  });
}

/** Keys are derived from labels: lowercase, dashes, vocabulary-safe. */
export function keyForLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export async function createStrengthOption(
  sessionToken: string,
  key: string,
  label: string,
): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-strengths/create', {
    method: 'POST',
    sessionToken,
    body: { key, label },
    parse: () => null,
  });
}

export async function toggleStrengthOption(
  sessionToken: string,
  key: string,
  active: boolean,
): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-strengths/toggle', {
    method: 'POST',
    sessionToken,
    body: { key, active },
    parse: () => null,
  });
}
