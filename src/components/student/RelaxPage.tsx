/**
 * The Relax room (Phase 11, Spec §6.3): a place to put the day down.
 * Breathing guide (visual, with a text-only rhythm under reduced motion),
 * generated calm sounds, the 5-4-3-2-1 grounding walk, and the
 * admin-curated library. Breathing/sounds/grounding are pure client code —
 * offline by construction; the library ride's the service worker's one
 * allowed API cache.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  BREATH_PATTERNS,
  breathMomentAt,
  fetchRelaxLibrary,
  GROUNDING_STEPS,
  KIND_HEADINGS,
  type BreathPattern,
  type RelaxItem,
  type RelaxKind,
} from '@/lib/relaxation';
import {
  isAudioSupported,
  setSoundscapeVolume,
  startSoundscape,
  stopSoundscape,
  SOUNDSCAPES,
  type SoundscapeId,
} from '@/lib/calmAudio';
import { logger } from '@/lib/logger';
import { useAuth } from '@/lib/authStore';

type LibraryState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: RelaxItem[] };

const KIND_ORDER: readonly RelaxKind[] = ['affirmation', 'scripture', 'grounding'];

function BreathingGuide() {
  const [pattern, setPattern] = useState<BreathPattern>(() => {
    const first = BREATH_PATTERNS[0];
    if (first === undefined) {
      throw new Error('no breathing patterns configured');
    }
    return first;
  });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [startedAt]);

  const moment = startedAt === null ? null : breathMomentAt(pattern, Math.max(0, now - startedAt));

  return (
    <section className="relax-card" aria-label="Breathing guide">
      <h2 className="events-title">Breathe</h2>
      <div className="admin-confirm-group" role="radiogroup" aria-label="Breathing pattern">
        {BREATH_PATTERNS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={pattern.id === p.id}
            className={
              pattern.id === p.id ? 'share-reaction share-reaction-mine' : 'share-reaction'
            }
            onClick={() => {
              setPattern(p);
              setStartedAt(null);
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <p className="door-sub">{pattern.hint}</p>

      <div className="breath-stage">
        <div
          className={
            moment === null ? 'breath-circle' : `breath-circle breath-circle-${moment.shape}`
          }
          style={
            moment === null ? undefined : { transitionDuration: `${String(moment.stepSeconds)}s` }
          }
          aria-hidden="true"
        />
        <p className="breath-label" role="status">
          {moment === null
            ? 'Ready when you are.'
            : `${moment.label} · ${String(moment.secondsLeft)}`}
        </p>
      </div>

      <button
        type="button"
        className="crown-check-submit"
        onClick={() => {
          if (startedAt === null) {
            const started = Date.now();
            setStartedAt(started);
            setNow(started);
          } else {
            setStartedAt(null);
          }
        }}
      >
        {startedAt === null ? 'Begin' : 'I feel better'}
      </button>
    </section>
  );
}

function CalmSounds() {
  const [playing, setPlaying] = useState<SoundscapeId | null>(null);
  const [volume, setVolume] = useState(0.5);
  const playingRef = useRef<SoundscapeId | null>(null);

  useEffect(() => {
    return () => {
      // Leaving the room ends the sound — nothing plays over other pages.
      if (playingRef.current !== null) {
        stopSoundscape();
      }
    };
  }, []);

  if (!isAudioSupported()) {
    return null;
  }

  return (
    <section className="relax-card" aria-label="Calm sounds">
      <h2 className="events-title">Calm sounds</h2>
      <p className="door-sub">Made by your device, right here — nothing to download.</p>
      <div className="admin-confirm-group">
        {SOUNDSCAPES.map((sound) => (
          <button
            key={sound.id}
            type="button"
            className={
              playing === sound.id ? 'share-reaction share-reaction-mine' : 'share-reaction'
            }
            aria-pressed={playing === sound.id}
            onClick={() => {
              if (playing === sound.id) {
                stopSoundscape();
                playingRef.current = null;
                setPlaying(null);
              } else {
                void startSoundscape(sound.id).catch(() => {
                  // Autoplay policies can refuse; the room stays calm.
                  logger.warn('relax.soundscape_start_failed');
                  playingRef.current = null;
                  setPlaying(null);
                });
                playingRef.current = sound.id;
                setPlaying(sound.id);
              }
            }}
          >
            {sound.name}
          </button>
        ))}
      </div>
      <label className="crown-check-note">
        <span className="crown-check-note-label">Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => {
            const next = Number(e.target.value) / 100;
            setVolume(next);
            setSoundscapeVolume(next);
          }}
        />
      </label>
    </section>
  );
}

function GroundingWalk() {
  const [step, setStep] = useState<number | null>(null);
  const current = step === null ? undefined : GROUNDING_STEPS[step];

  return (
    <section className="relax-card" aria-label="Ground yourself">
      <h2 className="events-title">Ground yourself</h2>
      {current === undefined ? (
        <>
          <p className="door-sub">
            Five senses, one minute — a gentle way back to right here, right now.
          </p>
          <button
            type="button"
            className="crown-check-submit"
            onClick={() => {
              setStep(0);
            }}
          >
            {step === null ? 'Start the 5·4·3·2·1' : 'You made it. Go again?'}
          </button>
        </>
      ) : (
        <>
          <p className="breath-label" role="status">
            <span className="grounding-count" aria-hidden="true">
              {current.count}
            </span>
            {current.prompt}
          </p>
          <button
            type="button"
            className="crown-check-submit"
            onClick={() => {
              // Finishing parks past the last index — the invitation flips
              // to "go again" instead of pretending she never started.
              setStep(
                step !== null && step + 1 < GROUNDING_STEPS.length
                  ? step + 1
                  : GROUNDING_STEPS.length,
              );
            }}
          >
            {step !== null && step + 1 < GROUNDING_STEPS.length ? 'Done — next' : 'Finish'}
          </button>
        </>
      )}
    </section>
  );
}

export function RelaxPage() {
  const session = useAuth();
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (session === null) {
      return;
    }
    let cancelled = false;
    fetchRelaxLibrary()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setLibrary(result.ok ? { status: 'ready', items: result.data } : { status: 'error' });
      })
      .catch(() => {
        if (!cancelled) {
          setLibrary({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, attempt]);

  if (session === null) {
    return null;
  }

  return (
    <div className="app-shell page-glow">
      <header className="share-header">
        <Link to="/" className="share-back">
          ← Home
        </Link>
        <h1 className="page-title">
          <span className="page-title-mark" aria-hidden="true">
            🕊️
          </span>
          Relax
        </h1>
        <p className="journal-transparency">Put the day down for a minute. It can wait.</p>
      </header>

      <BreathingGuide />
      <CalmSounds />
      <GroundingWalk />

      {library.status === 'error' && (
        <section className="relax-card" aria-label="Calming library">
          <p className="daily-message-loading">
            The library couldn’t load — the breathing and grounding above work without it.
          </p>
          <button
            type="button"
            className="daily-message-retry"
            onClick={() => {
              setLibrary({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </section>
      )}

      {library.status === 'ready' &&
        KIND_ORDER.map((kind) => {
          const items = library.items.filter((item) => item.kind === kind);
          if (items.length === 0) {
            return null;
          }
          return (
            <section key={kind} className="relax-card" aria-label={KIND_HEADINGS[kind]}>
              <h2 className="events-title">{KIND_HEADINGS[kind]}</h2>
              {items.map((item) => (
                <article key={item.id} className="relax-item">
                  <h3 className="announcement-title">{item.title}</h3>
                  <p className="announcement-body">{item.body}</p>
                </article>
              ))}
            </section>
          );
        })}
    </div>
  );
}
