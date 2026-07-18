/**
 * About Page section (Phase 12, Spec §6.9): edit the public About Us page —
 * the Royal Diadem story and Pastor Kenecia's bio. What's saved here is
 * live for everyone immediately (it's the public front door's content).
 */
import { useEffect, useState } from 'react';
import type { AboutSection } from '@/lib/about';
import { listAboutSections, saveAboutSection } from '@/lib/adminAbout';
import { useAuth } from '@/lib/authStore';

type Draft = { title: string; body: string };
type Drafts = Record<AboutSection, Draft>;

type ViewState = 'loading' | 'error' | 'ready';

const SECTION_META: readonly { section: AboutSection; heading: string; help: string }[] = [
  {
    section: 'about_org',
    heading: 'Our story',
    help: 'Mission, history, what the program is — the first thing a visitor reads.',
  },
  {
    section: 'pastor_bio',
    heading: 'Pastor Kenecia Duncan',
    help: 'Her bio, shown beside her portrait.',
  },
];

const EMPTY_DRAFTS: Drafts = {
  about_org: { title: '', body: '' },
  pastor_bio: { title: '', body: '' },
};

export function AboutAdminPage() {
  const session = useAuth();
  const token = session?.token;

  const [state, setState] = useState<ViewState>('loading');
  const [drafts, setDrafts] = useState<Drafts>(EMPTY_DRAFTS);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void listAboutSections(token).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setState('error');
        return;
      }
      const next: Drafts = {
        about_org: { title: '', body: '' },
        pastor_bio: { title: '', body: '' },
      };
      for (const row of result.data) {
        next[row.section] = { title: row.title, body: row.body };
      }
      setDrafts(next);
      setState('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [token, reload]);

  if (token === undefined) {
    return null;
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-section-title">About Page</h2>
      </div>

      <p className="admin-section-note">
        This is the public About page — visitors read it before they ever sign in. Saving publishes
        immediately.
      </p>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      {state === 'loading' && <p className="admin-section-note">Loading the page…</p>}
      {state === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load the About page. Check your connection and try again.
          </p>
          <button
            type="button"
            className="admin-retry-button"
            onClick={() => {
              setState('loading');
              setReload((n) => n + 1);
            }}
          >
            Try again
          </button>
        </>
      )}

      {state === 'ready' &&
        SECTION_META.map(({ section, heading, help }) => (
          <div key={section} className="calendar-editor">
            <h3 className="admin-subsection-title">{heading}</h3>
            <p className="admin-section-note">{help}</p>
            <label className="crown-check-note">
              <span className="crown-check-note-label">Heading</span>
              <input
                type="text"
                value={drafts[section].title}
                maxLength={120}
                disabled={busy}
                onChange={(e) => {
                  setDrafts((d) => ({ ...d, [section]: { ...d[section], title: e.target.value } }));
                }}
              />
            </label>
            <label className="crown-check-note">
              <span className="crown-check-note-label">Text</span>
              <textarea
                value={drafts[section].body}
                maxLength={8000}
                rows={6}
                disabled={busy}
                onChange={(e) => {
                  setDrafts((d) => ({ ...d, [section]: { ...d[section], body: e.target.value } }));
                }}
              />
            </label>
            <div className="admin-confirm-group">
              <button
                type="button"
                className="admin-retry-button"
                disabled={
                  busy || drafts[section].title.trim() === '' || drafts[section].body.trim() === ''
                }
                onClick={() => {
                  setBusy(true);
                  setNotice('');
                  void saveAboutSection(
                    token,
                    section,
                    drafts[section].title.trim(),
                    drafts[section].body.trim(),
                  )
                    .then((result) => {
                      setNotice(
                        result.ok
                          ? `${heading} is live on the About page.`
                          : 'That didn’t go through. Try again.',
                      );
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                Publish {heading}
              </button>
            </div>
          </div>
        ))}
    </section>
  );
}
