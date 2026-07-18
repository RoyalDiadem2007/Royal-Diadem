/**
 * About Us (Phase 12, Spec §6.9): the Royal Diadem story and Pastor Kenecia
 * Duncan's bio — genuinely public content, reachable signed-out from the
 * landing page and signed-in alike. Text comes from the admin-editable
 * about_content sections; her portrait placement here (never the landing
 * page) is Kenecia's decision (OD-20). Sections not written yet stay warm,
 * not broken.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { brand } from '@/config/branding.config';
import { fetchAboutContent, type AboutContent } from '@/lib/about';

type ViewState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; sections: AboutContent[] };

/** Kenecia-approved placement: her portrait lives on the bio, web-sized copy. */
const PASTOR_PHOTO = '/assets/kenecia-headshot-web.jpg';

export function AboutPage() {
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchAboutContent()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setState(result.ok ? { status: 'ready', sections: result.data } : { status: 'error' });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const sectionFor = (name: AboutContent['section']): AboutContent | undefined =>
    state.status === 'ready' ? state.sections.find((s) => s.section === name) : undefined;
  const org = sectionFor('about_org');
  const bio = sectionFor('pastor_bio');

  return (
    <div className="app-shell page-glow">
      <header className="share-header">
        <Link to="/" className="share-back">
          ← Back
        </Link>
        <h1 className="page-title">About {brand.name}</h1>
      </header>

      {state.status === 'loading' && <p className="daily-message-loading">Opening our story…</p>}
      {state.status === 'error' && (
        <section className="relax-card" aria-label="About">
          <p className="daily-message-loading">
            Our story couldn’t load. Check your connection and try again.
          </p>
          <button
            type="button"
            className="daily-message-retry"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </section>
      )}

      {state.status === 'ready' && (
        <>
          <section className="relax-card" aria-label="Our story">
            {org === undefined ? (
              <p className="daily-message-loading">
                Our story is still being written — check back soon.
              </p>
            ) : (
              <>
                <h2 className="events-title">{org.title}</h2>
                <p className="announcement-body">{org.body}</p>
              </>
            )}
          </section>

          <section className="relax-card" aria-label="Pastor Kenecia Duncan">
            <img
              className="about-portrait"
              src={PASTOR_PHOTO}
              alt="Pastor Kenecia Duncan"
              loading="lazy"
            />
            {bio === undefined ? (
              <p className="daily-message-loading">
                Pastor Kenecia’s story is on its way — check back soon.
              </p>
            ) : (
              <>
                <h2 className="events-title">{bio.title}</h2>
                <p className="announcement-body">{bio.body}</p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
