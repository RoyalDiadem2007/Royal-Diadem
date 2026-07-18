/**
 * The Journal's own room (Maria's call 2026-07-18): writing is a longer,
 * quieter activity than the home screen's quick check-in, so it opens on
 * its own page. The Journal component itself is unchanged — same
 * transparency deal, same prompts, same writing support.
 */
import { Link } from 'react-router';
import { Journal } from '@/components/student/Journal';

export function JournalPage() {
  return (
    <div className="app-shell page-glow">
      <header className="share-header">
        <Link to="/" className="share-back">
          ← Home
        </Link>
        <h1 className="page-title">My Journal</h1>
        <p className="journal-transparency">A quiet place for what today held.</p>
      </header>
      <Journal />
    </div>
  );
}
