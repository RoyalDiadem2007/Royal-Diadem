/**
 * Encouragement section (Phase 7, Spec §6.5): the weekly draft → review →
 * approve → post workflow on the OD-18 governed gateway. The human is the
 * gate — nothing here reaches a student until she approves AND posts it.
 * Rejections and replacements feed the corrective loop (ai_corrections +
 * human-approved rules the gateway enforces on future generations).
 */
import { useEffect, useState } from 'react';
import {
  approveMessage,
  createAiRule,
  generateWeek,
  listAiRules,
  listWeek,
  mondayOf,
  postWeek,
  rejectMessage,
  replaceMessage,
  shiftWeek,
  toggleAiRule,
  type AiRule,
  type EncouragementMessage,
} from '@/lib/adminEncouragement';
import { useAuth } from '@/lib/authStore';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type WeekState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; messages: EncouragementMessage[] };

type Editor = { messageId: string; mode: 'reject' | 'replace' } | null;

/** The row shown per day: the latest live (non-rejected) message, if any. */
function liveMessageFor(
  messages: EncouragementMessage[],
  date: string,
): EncouragementMessage | null {
  const candidates = messages.filter((m) => m.scheduledDate === date && m.status !== 'rejected');
  return candidates.at(-1) ?? null;
}

function dayDates(weekOf: string): string[] {
  return DAY_NAMES.map((_, i) => {
    const d = new Date(`${weekOf}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function EncouragementPage() {
  const session = useAuth();
  const token = session?.token;

  const [weekOf, setWeekOf] = useState(() => mondayOf(new Date()));
  const [week, setWeek] = useState<WeekState>({ status: 'loading' });
  const [rules, setRules] = useState<AiRule[] | null>(null);
  const [newRule, setNewRule] = useState('');
  const [editor, setEditor] = useState<Editor>(null);
  const [reason, setReason] = useState('');
  const [replacement, setReplacement] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void Promise.all([listWeek(token, weekOf), listAiRules(token)]).then(
      ([weekResult, rulesResult]) => {
        if (cancelled) {
          return;
        }
        setWeek(
          weekResult.ok ? { status: 'ready', messages: weekResult.data } : { status: 'error' },
        );
        setRules(rulesResult.ok ? rulesResult.data : null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, weekOf, reload]);

  if (token === undefined) {
    return null;
  }

  const refresh = (): void => {
    setWeek({ status: 'loading' });
    setEditor(null);
    setReason('');
    setReplacement('');
    setReload((n) => n + 1);
  };

  const run = (work: Promise<{ ok: boolean }>, successNotice: string): void => {
    setBusy(true);
    setNotice('');
    void work
      .then((result) => {
        if (result.ok) {
          setNotice(successNotice);
          refresh();
        } else {
          setNotice('That didn’t go through. Try again.');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const messages = week.status === 'ready' ? week.messages : [];
  const approvedCount = messages.filter((m) => m.status === 'approved').length;
  const hasLive = messages.some((m) => m.status !== 'rejected');

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Encouragement</h2>
        <div className="admin-confirm-group">
          <button
            type="button"
            className="logout-button"
            onClick={() => {
              setWeekOf(shiftWeek(weekOf, -1));
              setWeek({ status: 'loading' });
            }}
          >
            ← Previous week
          </button>
          <span className="admin-section-note">Week of {weekOf}</span>
          <button
            type="button"
            className="logout-button"
            onClick={() => {
              setWeekOf(shiftWeek(weekOf, 1));
              setWeek({ status: 'loading' });
            }}
          >
            Next week →
          </button>
        </div>
      </div>

      <p className="admin-section-note">
        The AI drafts; you decide. Nothing reaches the girls until you approve each day and post the
        week.
      </p>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      <div className="admin-confirm-group">
        <button
          type="button"
          className="admin-retry-button"
          disabled={busy}
          onClick={() => {
            run(
              generateWeek(token, weekOf),
              hasLive
                ? 'Fresh drafts generated — unreviewed drafts were replaced.'
                : 'Seven drafts generated. Review each day below.',
            );
          }}
        >
          {busy ? 'Working…' : hasLive ? 'Regenerate drafts' : "Generate this week's messages"}
        </button>
        <button
          type="button"
          className="admin-retry-button"
          disabled={busy || approvedCount === 0}
          onClick={() => {
            run(
              postWeek(token, weekOf),
              'Posted. Each day’s message will show as the Daily Crown Message.',
            );
          }}
        >
          Post approved ({approvedCount})
        </button>
      </div>

      {week.status === 'loading' && <p className="admin-section-note">Loading the week…</p>}
      {week.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load this week. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {week.status === 'ready' &&
        dayDates(weekOf).map((date, i) => {
          const message = liveMessageFor(messages, date);
          return (
            <article key={date} className="encouragement-day">
              <p className="admin-table-sub">
                {DAY_NAMES[i]} · {date}
                {message !== null && (
                  <span className={`encouragement-status encouragement-status-${message.status}`}>
                    {' '}
                    {message.status}
                    {message.source === 'admin_written' ? ' · yours' : ''}
                  </span>
                )}
              </p>
              {message === null ? (
                <p className="admin-section-note">No message yet — generate drafts above.</p>
              ) : (
                <>
                  <p className="encouragement-text">{message.text}</p>
                  {message.status !== 'posted' && editor?.messageId !== message.id && (
                    <div className="admin-confirm-group">
                      {message.status === 'draft' && (
                        <button
                          type="button"
                          className="admin-retry-button"
                          disabled={busy}
                          onClick={() => {
                            run(
                              approveMessage(token, message.id),
                              `${DAY_NAMES[i] ?? 'Day'} approved.`,
                            );
                          }}
                        >
                          Approve
                        </button>
                      )}
                      <button
                        type="button"
                        className="logout-button"
                        disabled={busy}
                        onClick={() => {
                          setEditor({ messageId: message.id, mode: 'replace' });
                          setReplacement(message.text);
                          setReason('');
                        }}
                      >
                        Write my own
                      </button>
                      <button
                        type="button"
                        className="logout-button"
                        disabled={busy}
                        onClick={() => {
                          setEditor({ messageId: message.id, mode: 'reject' });
                          setReason('');
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {editor?.messageId === message.id && (
                    <div className="encouragement-editor">
                      {editor.mode === 'replace' && (
                        <label className="crown-check-note">
                          <span className="crown-check-note-label">Your message (max 280)</span>
                          <textarea
                            value={replacement}
                            maxLength={280}
                            rows={3}
                            onChange={(e) => {
                              setReplacement(e.target.value);
                            }}
                          />
                        </label>
                      )}
                      <label className="crown-check-note">
                        <span className="crown-check-note-label">
                          Why? (recorded — it teaches the gateway)
                        </span>
                        <input
                          type="text"
                          value={reason}
                          maxLength={500}
                          onChange={(e) => {
                            setReason(e.target.value);
                          }}
                        />
                      </label>
                      <div className="admin-confirm-group">
                        <button
                          type="button"
                          className="admin-retry-button"
                          disabled={
                            busy ||
                            reason.trim() === '' ||
                            (editor.mode === 'replace' && replacement.trim() === '')
                          }
                          onClick={() => {
                            if (editor.mode === 'reject') {
                              run(
                                rejectMessage(token, message.id, reason.trim()),
                                'Rejected and recorded.',
                              );
                            } else {
                              run(
                                replaceMessage(
                                  token,
                                  message.id,
                                  replacement.trim(),
                                  reason.trim(),
                                ),
                                'Replaced with your words (approved).',
                              );
                            }
                          }}
                        >
                          {editor.mode === 'reject' ? 'Confirm reject' : 'Save my message'}
                        </button>
                        <button
                          type="button"
                          className="logout-button"
                          disabled={busy}
                          onClick={() => {
                            setEditor(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </article>
          );
        })}

      <div className="journal-prompts-manager">
        <h3 className="admin-subsection-title">Gateway rules</h3>
        <p className="admin-section-note">
          Rules you add here become absolute restrictions the AI must follow in every future
          generation. Human-approved only — nothing learns on its own.
        </p>
        <div className="journal-prompt-add">
          <input
            type="text"
            value={newRule}
            maxLength={500}
            placeholder="e.g. Never mention specific churches or denominations"
            aria-label="New gateway rule"
            onChange={(e) => {
              setNewRule(e.target.value);
            }}
          />
          <button
            type="button"
            className="admin-retry-button"
            disabled={newRule.trim() === '' || busy}
            onClick={() => {
              const text = newRule.trim();
              setNewRule('');
              run(createAiRule(token, text), 'Rule added — it applies to the next generation.');
            }}
          >
            Add rule
          </button>
        </div>
        {rules !== null && rules.length > 0 && (
          <ul className="journal-prompt-list">
            {rules.map((rule) => (
              <li key={rule.id}>
                <span className={rule.active ? '' : 'journal-prompt-retired'}>{rule.text}</span>
                <button
                  type="button"
                  className="logout-button"
                  disabled={busy}
                  onClick={() => {
                    run(
                      toggleAiRule(token, rule.id, !rule.active),
                      rule.active ? 'Rule retired.' : 'Rule reactivated.',
                    );
                  }}
                >
                  {rule.active ? 'Retire' : 'Reactivate'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
