/**
 * Writes to the append-only audit_logs table (CLAUDE.md §17.2). Metadata
 * carries ids/codes only — never contents. A failed audit write is loud
 * (operational alert) but does not take auth down with it: denying every
 * login during an audit-table incident would trade one compliance property
 * for total unavailability. The failure itself is captured in function logs.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { serverLog } from './logger.ts';

export type AuditEntry = {
  actorType: 'student' | 'admin' | 'guardian' | 'system';
  actorId: string | null;
  actorRole: 'student' | 'super_admin' | 'mentor' | 'viewer' | 'guardian' | 'system' | null;
  action: 'create' | 'read' | 'update' | 'delete' | 'login' | 'logout' | 'consent' | 'export';
  entityType: string;
  entityId: string | null;
  outcome: 'allowed' | 'denied';
  ip: string | null;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
};

export async function writeAudit(db: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await db.from('audit_logs').insert({
    actor_type: entry.actorType,
    actor_id: entry.actorId,
    actor_role: entry.actorRole,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    outcome: entry.outcome,
    ip_address: entry.ip,
    metadata: entry.metadata ?? null,
  });
  if (error !== null) {
    serverLog.error('audit.write_failed', {
      auditAction: entry.action,
      auditEntityType: entry.entityType,
      auditOutcome: entry.outcome,
    });
  }
}
