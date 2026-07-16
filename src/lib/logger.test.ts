import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, logger, registerTransport, unregisterTransport, type LogEvent } from '@/lib/logger';

async function drainTo(events: LogEvent[]): Promise<void> {
  registerTransport((batch) => {
    events.push(...batch);
    return Promise.resolve();
  });
  await flush();
}

afterEach(async () => {
  // Drain whatever a test left behind so tests stay independent.
  await drainTo([]);
  unregisterTransport();
  vi.restoreAllMocks();
});

describe('audit logger', () => {
  it('delivers buffered events to a transport once one is registered', async () => {
    logger.info('auth.session_started', { sessionId: 'abc-123' });
    logger.warn('auth.rate_limited', { attempts: 3 });

    const received: LogEvent[] = [];
    await drainTo(received);

    expect(received).toHaveLength(2);
    expect(received[0]?.event).toBe('auth.session_started');
    expect(received[0]?.level).toBe('info');
    expect(received[1]?.fields.attempts).toBe(3);
  });

  it('redacts PHI/PII-shaped field keys before the event is stored', async () => {
    logger.error('journal.save_failed', {
      studentName: 'A Real Child',
      dateOfBirth: '2012-01-01',
      pinAttempt: '1234',
      entryText: 'private journal contents',
      guardianEmail: 'parent@example.com',
      entityId: 'row-42',
      httpStatus: 500,
    });

    const received: LogEvent[] = [];
    await drainTo(received);

    const fields = received[0]?.fields ?? {};
    expect(fields.studentName).toBe('[REDACTED]');
    expect(fields.dateOfBirth).toBe('[REDACTED]');
    expect(fields.pinAttempt).toBe('[REDACTED]');
    expect(fields.entryText).toBe('[REDACTED]');
    expect(fields.guardianEmail).toBe('[REDACTED]');
    // Ids and technical fields survive — log ids, never contents (CLAUDE.md §6).
    expect(fields.entityId).toBe('row-42');
    expect(fields.httpStatus).toBe(500);
  });

  it('truncates oversized string fields so payloads stay bounded', async () => {
    logger.info('sync.retry', { url: 'x'.repeat(2000) });

    const received: LogEvent[] = [];
    await drainTo(received);

    const url = received[0]?.fields.url;
    if (typeof url !== 'string') {
      throw new Error('expected the url field to survive as a string');
    }
    expect(url.length).toBe(500);
  });

  it('drops the oldest events beyond the buffer cap instead of growing unbounded', async () => {
    for (let i = 0; i < 230; i += 1) {
      logger.info('tick', { seq: i });
    }

    const received: LogEvent[] = [];
    await drainTo(received);

    expect(received).toHaveLength(200);
    expect(received[0]?.fields.seq).toBe(30);
    expect(received[199]?.fields.seq).toBe(229);
  });

  it('re-buffers the batch when the transport fails, then delivers on retry', async () => {
    logger.info('calendar.viewed', { eventId: 'evt-1' });

    const failing = vi.fn(() => Promise.reject(new Error('network down')));
    registerTransport(failing);
    await flush();
    expect(failing).toHaveBeenCalledTimes(1);

    const received: LogEvent[] = [];
    await drainTo(received);

    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe('calendar.viewed');
  });

  it('stamps events with a UTC ISO-8601 timestamp', async () => {
    logger.info('app.started');

    const received: LogEvent[] = [];
    await drainTo(received);

    expect(received[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
