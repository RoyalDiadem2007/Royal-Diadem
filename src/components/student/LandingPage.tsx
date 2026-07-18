/**
 * Public landing page (OD-20, revised per Kenecia 2026-07-17): no photo of
 * her on the front door — the logo carries the page, large and centered with
 * a soft glow, over a short warm write-up, and the arrow at the bottom leads
 * to sign-in. Public, non-regulated content only; every word and image comes
 * from the branding config (white-label, Spec §3).
 */
import { Link } from 'react-router';
import { brand } from '@/config/branding.config';

export function LandingPage() {
  return (
    <div className="landing-page">
      <div className="landing-hero">
        <img src={brand.logo} alt={`${brand.name} logo`} className="landing-logo" />
        <h1 className="landing-title">{brand.name}</h1>
        {brand.tagline !== '' && <p className="landing-tagline">{brand.tagline}</p>}
      </div>

      <p className="landing-blurb">{brand.landingBlurb}</p>

      <Link to="/login" className="landing-enter" aria-label="Continue to sign in">
        <span className="landing-enter-arrow" aria-hidden="true">
          ↓
        </span>
        <span className="landing-enter-text">Sign in</span>
      </Link>

      <Link to="/about" className="landing-about-link">
        About {brand.name}
      </Link>
    </div>
  );
}
