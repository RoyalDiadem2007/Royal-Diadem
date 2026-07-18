/**
 * Royal Diadem Share (Phase 10a, Spec §6.8): the celebration feed — text
 * posts, comments, crown-themed reactions. A SAFE SPACE: your own pending
 * items are labeled and visible only to you; the peer flag ("Something
 * doesn't feel right") quietly hides content for admin review and stays
 * anonymous to other students. Photos arrive in Phase 10b.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  addComment,
  createPost,
  fetchFeed,
  flagContent,
  toggleReaction,
  type ShareFeed,
} from '@/lib/share';
import { useAuth } from '@/lib/authStore';

type ViewState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; feed: ShareFeed };

function friendlyDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function SharePage() {
  const session = useAuth();
  const token = session?.token;

  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [draft, setDraft] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [confirmFlagId, setConfirmFlagId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void fetchFeed(token, 1).then((result) => {
      if (cancelled) {
        return;
      }
      setState(result.ok ? { status: 'ready', feed: result.data } : { status: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [token, reload]);

  if (token === undefined) {
    return null;
  }

  const refresh = (): void => {
    setConfirmFlagId(null);
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
          setNotice('That didn’t go through. Try again in a moment.');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="app-shell">
      <header className="share-header">
        <Link to="/" className="share-back">
          ← Home
        </Link>
        <h1 className="events-title">Royal Diadem Share</h1>
        <p className="journal-transparency">
          Celebrate each other, queens. An admin looks after this space.
        </p>
      </header>

      <section className="share-composer" aria-label="Share something">
        <label className="crown-check-note">
          <span className="crown-check-note-label">What are you celebrating today?</span>
          <textarea
            value={draft}
            maxLength={1000}
            rows={3}
            disabled={busy}
            spellCheck={true}
            autoCorrect="on"
            autoCapitalize="sentences"
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="crown-check-submit"
          disabled={busy || draft.trim() === ''}
          onClick={() => {
            const text = draft.trim();
            setDraft('');
            setBusy(true);
            setNotice('');
            void createPost(token, text)
              .then((result) => {
                if (result.ok) {
                  // Pre-approval mode: tell her it's sent, not lost.
                  setNotice(
                    result.data.status === 'pending'
                      ? 'Sent! An admin will take a quick look before it goes up.'
                      : 'Posted! 👑',
                  );
                  refresh();
                } else {
                  setNotice('That didn’t go through. Try again in a moment.');
                }
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {busy ? 'Sharing…' : 'Share it'}
        </button>
      </section>

      {notice !== '' && (
        <p className="share-notice" role="status">
          {notice}
        </p>
      )}

      {state.status === 'loading' && <p className="daily-message-loading">Opening the feed…</p>}
      {state.status === 'error' && (
        <section className="events-card" aria-label="Share feed">
          <p className="daily-message-loading">
            The feed couldn’t load. Check your connection and try again.
          </p>
          <button
            type="button"
            className="daily-message-retry"
            onClick={() => {
              setState({ status: 'loading' });
              refresh();
            }}
          >
            Try again
          </button>
        </section>
      )}

      {state.status === 'ready' && state.feed.posts.length === 0 && (
        <p className="daily-message-loading">Nothing here yet — be the first to share something!</p>
      )}

      {state.status === 'ready' &&
        state.feed.posts.map((post) => (
          <article key={post.id} className="share-post" aria-label={`Post by ${post.authorName}`}>
            <p className="announcement-meta">
              <strong>{post.authorName}</strong> · {friendlyDate(post.createdAt)}
              {post.status === 'pending' && (
                <span className="share-pending-tag"> Waiting for review — only you see this</span>
              )}
            </p>
            {post.contentText !== null && <p className="announcement-body">{post.contentText}</p>}

            <div className="share-reactions" role="group" aria-label="Reactions">
              {state.feed.reactionSet.map((emoji) => {
                const count = post.reactions[emoji] ?? 0;
                const mine = post.myReactions.includes(emoji);
                return (
                  <button
                    key={emoji}
                    type="button"
                    className={mine ? 'share-reaction share-reaction-mine' : 'share-reaction'}
                    aria-pressed={mine}
                    aria-label={`React ${emoji}`}
                    disabled={busy || post.status !== 'approved'}
                    onClick={() => {
                      run(toggleReaction(token, post.id, emoji), '');
                    }}
                  >
                    <span aria-hidden="true">{emoji}</span>
                    {count > 0 && <span className="share-reaction-count">{count}</span>}
                  </button>
                );
              })}
            </div>

            {post.comments.map((comment) => (
              <p key={comment.id} className="share-comment">
                <strong>{comment.authorName}</strong> {comment.text}
                {comment.status === 'pending' && (
                  <span className="share-pending-tag"> Waiting for review</span>
                )}
                {!comment.mine &&
                  comment.status === 'approved' &&
                  (confirmFlagId === `comment-${comment.id}` ? (
                    <span className="admin-confirm-group">
                      <span className="share-flag-confirm">Tell an admin? It stays anonymous.</span>
                      <button
                        type="button"
                        className="share-flag-button"
                        disabled={busy}
                        onClick={() => {
                          run(
                            flagContent(token, 'comment', comment.id),
                            'Thank you for saying something. An admin will take a look.',
                          );
                        }}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="share-flag-button"
                        disabled={busy}
                        onClick={() => {
                          setConfirmFlagId(null);
                        }}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="share-flag-button"
                      aria-label={`This comment doesn't feel right`}
                      disabled={busy}
                      onClick={() => {
                        setConfirmFlagId(`comment-${comment.id}`);
                      }}
                    >
                      🚩
                    </button>
                  ))}
              </p>
            ))}

            {post.status === 'approved' && (
              <div className="share-comment-add">
                <input
                  type="text"
                  value={commentDrafts[post.id] ?? ''}
                  maxLength={500}
                  placeholder="Hype her up…"
                  aria-label={`Comment on ${post.authorName}'s post`}
                  disabled={busy}
                  spellCheck={true}
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  onChange={(e) => {
                    setCommentDrafts((d) => ({ ...d, [post.id]: e.target.value }));
                  }}
                />
                <button
                  type="button"
                  className="daily-message-retry"
                  disabled={busy || (commentDrafts[post.id] ?? '').trim() === ''}
                  onClick={() => {
                    const text = (commentDrafts[post.id] ?? '').trim();
                    setCommentDrafts((d) => ({ ...d, [post.id]: '' }));
                    run(addComment(token, post.id, text), 'Comment sent.');
                  }}
                >
                  Send
                </button>
              </div>
            )}

            {!post.mine && post.status === 'approved' && (
              <div className="share-flag">
                {confirmFlagId === post.id ? (
                  <span className="admin-confirm-group">
                    <span className="share-flag-confirm">
                      Tell an admin about this post? No one else will know it was you.
                    </span>
                    <button
                      type="button"
                      className="daily-message-retry"
                      disabled={busy}
                      onClick={() => {
                        run(
                          flagContent(token, 'post', post.id),
                          'Thank you for saying something. An admin will take a look.',
                        );
                      }}
                    >
                      Yes, tell an admin
                    </button>
                    <button
                      type="button"
                      className="share-flag-button"
                      disabled={busy}
                      onClick={() => {
                        setConfirmFlagId(null);
                      }}
                    >
                      Never mind
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="share-flag-button"
                    disabled={busy}
                    onClick={() => {
                      setConfirmFlagId(post.id);
                    }}
                  >
                    Something doesn’t feel right
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
    </div>
  );
}
