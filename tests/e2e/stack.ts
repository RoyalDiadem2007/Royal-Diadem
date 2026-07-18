/**
 * Helpers for talking to the LOCAL Supabase stack in E2E tests. The service
 * key here is the local stack's throwaway credential (printed by `supabase
 * status`), never a production secret.
 */
import { env } from 'node:process';

export const API_URL = env.SUPABASE_E2E_URL ?? 'http://127.0.0.1:54321';

export function serviceKey(): string {
  const key = env.SUPABASE_E2E_SERVICE_KEY;
  if (key === undefined || key === '') {
    throw new Error(
      'SUPABASE_E2E_SERVICE_KEY is not set. Start the stack (npx supabase start), then run: ' +
        'SUPABASE_E2E_SERVICE_KEY="$(npx supabase status -o json | jq -r .SERVICE_ROLE_KEY)" npm run test:e2e',
    );
  }
  return key;
}

/** The local stack's anon key — for tests exercising the anon RLS boundary. */
export function anonKey(): string {
  const key = env.SUPABASE_E2E_ANON_KEY;
  if (key === undefined || key === '') {
    throw new Error(
      'SUPABASE_E2E_ANON_KEY is not set. Start the stack (npx supabase start), then run: ' +
        'SUPABASE_E2E_ANON_KEY="$(npx supabase status -o json | jq -r .ANON_KEY)" npm run test:e2e',
    );
  }
  return key;
}

function restHeaders(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    apikey: serviceKey(),
    Authorization: `Bearer ${serviceKey()}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** Direct PostgREST access with the service key — test seeding/inspection only. */
export async function restInsert(
  table: string,
  rows: readonly Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${API_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`seed insert into ${table} failed: ${String(res.status)} ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>[];
}

export async function restUpdate(
  table: string,
  filter: string,
  patch: Readonly<Record<string, unknown>>,
): Promise<void> {
  const res = await fetch(`${API_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: restHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`update of ${table} failed: ${String(res.status)}`);
  }
}

export async function restDelete(table: string, filter: string): Promise<void> {
  const res = await fetch(`${API_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: restHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`cleanup delete from ${table} failed: ${String(res.status)}`);
  }
}

export async function restSelect(
  table: string,
  filter: string,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${API_URL}/rest/v1/${table}?${filter}`, {
    headers: restHeaders(),
  });
  if (!res.ok) {
    throw new Error(`select from ${table} failed: ${String(res.status)}`);
  }
  return (await res.json()) as Record<string, unknown>[];
}

/** Calls a deployed Edge Function exactly as the real client would. */
export async function callFunction(
  name: string,
  options: {
    method: 'GET' | 'POST';
    body?: Readonly<Record<string, unknown>>;
    bearer?: string;
  },
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.bearer !== undefined) {
    headers.Authorization = `Bearer ${options.bearer}`;
  }
  return fetch(`${API_URL}/functions/v1/${name}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? null : JSON.stringify(options.body),
  });
}
