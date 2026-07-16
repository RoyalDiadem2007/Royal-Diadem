import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '@/App';
import { brand } from '@/config/branding.config';

describe('App shell (white-label)', () => {
  it('renders the organization name from the branding config, not a hardcoded string', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(brand.name);
  });

  it('renders the logo from the branding config path', () => {
    render(<App />);
    const logo = screen.getByRole('img', { name: `${brand.name} logo` });
    expect(logo).toHaveAttribute('src', brand.logo);
  });

  it('renders the tagline only when the client has provided one', () => {
    const { container } = render(<App />);
    const tagline = container.querySelector('.app-tagline');
    if (brand.tagline === '') {
      expect(tagline).toBeNull();
    } else {
      expect(tagline).toHaveTextContent(brand.tagline);
    }
  });
});
