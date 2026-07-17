/**
 * Public landing page (OD-20): the front door at `/` — logo, the founder's
 * photo, a short write-up about the organization, and an arrow at the bottom
 * that leads to the sign-in page. Public, non-regulated content only; every
 * word and image comes from the branding config (white-label, Spec §3).
 */
import { Link } from 'react-router';
import { brand } from '@/config/branding.config';

export function LandingPage() {
  return (
    <div className="landing-page">
      <img src={brand.logo} alt={`${brand.name} logo`} className="landing-logo" />
      <h1 className="landing-title">{brand.name}</h1>
      {brand.tagline !== '' && <p className="landing-tagline">{brand.tagline}</p>}

      <img
        src={brand.founder.photo}
        alt={`${brand.founder.name}, ${brand.founder.title}`}
        className="landing-founder-photo"
      />
      <p className="landing-founder-caption">
        {brand.founder.name} · {brand.founder.title}
      </p>

      <p className="landing-blurb">{brand.landingBlurb}</p>

      <Link to="/login" className="landing-enter" aria-label="Continue to sign in">
        <span className="landing-enter-arrow" aria-hidden="true">
          ↓
        </span>
        <span className="landing-enter-text">Sign in</span>
      </Link>
    </div>
  );
}
