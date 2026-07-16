import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginScreen } from '@/components/student/LoginScreen';
import { brand } from '@/config/branding.config';
import { login, loginWithPasskey } from '@/lib/authStore';
import { passkeysSupported } from '@/lib/passkey';

vi.mock('@/lib/authStore', () => ({
  login: vi.fn(() => Promise.resolve({ ok: true })),
  loginWithPasskey: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock('@/lib/passkey', () => ({
  passkeysSupported: vi.fn(() => true),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginScreen', () => {
  it('renders brand identity from the config only', () => {
    render(<LoginScreen />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(brand.name);
    expect(screen.getByRole('img', { name: `${brand.name} logo` })).toHaveAttribute(
      'src',
      brand.logo,
    );
  });

  it('keeps submit disabled until both fields are filled', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('PIN'), '123456');
    expect(submit).toBeEnabled();
  });

  it('submits the entered student credentials', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
    await user.type(screen.getByLabelText('PIN'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(vi.mocked(login)).toHaveBeenCalledWith({
      subjectType: 'student',
      identifier: 'RD-7F3K',
      pin: '123456',
    });
  });

  it('shows the failure message as an alert and recovers', async () => {
    vi.mocked(login).mockResolvedValueOnce({ ok: false, message: 'Nope, try again.' });
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
    await user.type(screen.getByLabelText('PIN'), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Nope, try again.');
    });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('offers passkey sign-in on capable devices and starts the ceremony', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole('button', { name: 'Sign in with Face ID / passkey' }));

    expect(vi.mocked(loginWithPasskey)).toHaveBeenCalledTimes(1);
  });

  it('hides the passkey button on devices without support', () => {
    vi.mocked(passkeysSupported).mockReturnValue(false);
    render(<LoginScreen />);
    expect(
      screen.queryByRole('button', { name: 'Sign in with Face ID / passkey' }),
    ).not.toBeInTheDocument();
  });

  it('switches to admin mode with an email field', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole('button', { name: 'Mentor or admin? Sign in here' }));

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'mentor@example.com');
    await user.type(screen.getByLabelText('PIN'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(vi.mocked(login)).toHaveBeenCalledWith({
      subjectType: 'admin',
      identifier: 'mentor@example.com',
      pin: '123456',
    });
  });
});
