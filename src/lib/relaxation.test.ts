import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BREATH_PATTERNS,
  breathMomentAt,
  fetchRelaxLibrary,
  GROUNDING_STEPS,
} from '@/lib/relaxation';

function patternById(id: string) {
  const pattern = BREATH_PATTERNS.find((p) => p.id === id);
  if (pattern === undefined) {
    throw new Error(`pattern ${id} missing`);
  }
  return pattern;
}

describe('breathMomentAt', () => {
  it('walks the box pattern: in, hold full, out, hold empty', () => {
    const box = patternById('box');
    expect(breathMomentAt(box, 0)).toEqual({
      label: 'Breathe in',
      secondsLeft: 4,
      shape: 'expand',
      stepSeconds: 4,
    });
    expect(breathMomentAt(box, 4500).label).toBe('Hold');
    expect(breathMomentAt(box, 4500).shape).toBe('hold-full');
    expect(breathMomentAt(box, 8500).shape).toBe('contract');
    // The hold after the exhale keeps the circle small.
    expect(breathMomentAt(box, 12_500).shape).toBe('hold-empty');
  });

  it('counts down whole seconds and never shows zero', () => {
    const box = patternById('box');
    expect(breathMomentAt(box, 1000).secondsLeft).toBe(3);
    expect(breathMomentAt(box, 3900).secondsLeft).toBe(1);
  });

  it('loops forever — the cycle wraps cleanly', () => {
    const box = patternById('box');
    const cycleMs = 16_000;
    expect(breathMomentAt(box, cycleMs)).toEqual(breathMomentAt(box, 0));
    expect(breathMomentAt(box, cycleMs * 3 + 4500).shape).toBe('hold-full');
  });

  it('4-7-8 holds full after the inhale and rolls straight from out to in', () => {
    const calm = patternById('calm');
    expect(breathMomentAt(calm, 4500).shape).toBe('hold-full');
    expect(breathMomentAt(calm, 12_000).shape).toBe('contract');
    expect(breathMomentAt(calm, 19_500).label).toBe('Breathe in');
  });
});

describe('grounding walk', () => {
  it('runs 5 down to 1', () => {
    expect(GROUNDING_STEPS.map((s) => s.count)).toEqual([5, 4, 3, 2, 1]);
  });
});

describe('fetchRelaxLibrary', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the library as anon in curated order', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'r-1', kind: 'scripture', title: 'Psalm 46:10', body: 'Be still…' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchRelaxLibrary();
    expect(result).toEqual({
      ok: true,
      data: [{ id: 'r-1', kind: 'scripture', title: 'Psalm 46:10', body: 'Be still…' }],
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/rest/v1/relaxation_content?');
    expect(url).toContain('order=kind.asc&order=sort_order.asc');
  });

  it('rejects a malformed row as a server failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 'r-1', kind: 'mystery' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    expect(await fetchRelaxLibrary()).toEqual({ ok: false, failure: { kind: 'server' } });
  });
});
