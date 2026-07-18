/**
 * Client for the admin-relaxation Edge Function (Phase 11): curating the
 * calming library the girls see in the Relax room.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';
import type { RelaxKind } from '@/lib/relaxation';

export type AdminRelaxItem = {
  id: string;
  kind: RelaxKind;
  title: string;
  body: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
};

export type RelaxItemInput = {
  kind: RelaxKind;
  title: string;
  body: string;
};

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseItem(raw: unknown): AdminRelaxItem {
  const r = asRecord(raw, 'item');
  if (
    typeof r.id !== 'string' ||
    (r.kind !== 'affirmation' && r.kind !== 'scripture' && r.kind !== 'grounding') ||
    typeof r.title !== 'string' ||
    typeof r.body !== 'string' ||
    typeof r.active !== 'boolean' ||
    typeof r.sortOrder !== 'number' ||
    typeof r.createdAt !== 'string'
  ) {
    throw new Error('item is malformed');
  }
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    active: r.active,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
  };
}

function parseList(raw: unknown): AdminRelaxItem[] {
  const r = asRecord(raw, 'items response');
  if (!Array.isArray(r.items)) {
    throw new Error('items response is malformed');
  }
  return r.items.map(parseItem);
}

export async function listRelaxItems(sessionToken: string): Promise<ApiResult<AdminRelaxItem[]>> {
  return callEdgeFunction('admin-relaxation?page=1', {
    method: 'GET',
    sessionToken,
    parse: parseList,
  });
}

export async function createRelaxItem(
  sessionToken: string,
  input: RelaxItemInput,
): Promise<ApiResult<AdminRelaxItem>> {
  return callEdgeFunction('admin-relaxation/create', {
    method: 'POST',
    sessionToken,
    body: input,
    parse: (raw) => parseItem(asRecord(raw, 'create response').item),
  });
}

export async function updateRelaxItem(
  sessionToken: string,
  item: AdminRelaxItem,
): Promise<ApiResult<AdminRelaxItem>> {
  return callEdgeFunction('admin-relaxation/update', {
    method: 'POST',
    sessionToken,
    body: {
      itemId: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      active: item.active,
      sortOrder: item.sortOrder,
    },
    parse: (raw) => parseItem(asRecord(raw, 'update response').item),
  });
}

export async function deleteRelaxItem(
  sessionToken: string,
  itemId: string,
): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-relaxation/delete', {
    method: 'POST',
    sessionToken,
    body: { itemId },
    parse: () => null,
  });
}
