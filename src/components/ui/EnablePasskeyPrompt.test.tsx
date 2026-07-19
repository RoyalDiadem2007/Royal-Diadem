import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnablePasskeyPrompt } from '@/components/ui/EnablePasskeyPrompt';
import { resetPromptMemoryForTests } from '@/lib/promptMemory';
import { registerPasskey, useAuth, type AuthSession } from '@/lib/authStore';
import { passkeysSupported } from '@/lib/passkey';

vi.mock('@/lib/authStore', () => ({
  useAuth: vi.fn(),
  registerPasskey: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock('@/lib/passkey', () => ({
  passkeysSupported: vi.fn(() => true),
}));

function sessionWith(webauthnRegistered: boolean): AuthSession {
  return {
    token: 't',
    expiresAt: '2026-07-17T00:00:00.000Z',
    webauthnRegistered,
    staffMode: false,
    subject: { type: 'student', id: 'stu-1', displayName: 'Jada', role: 'student' },
  };
}

beforeEach(() => {
  // clearAllMocks wipes factory implementations too — re-establish defaults.
  vi.mocked(passkeysSupported).mockReturnValue(true);
  vi.mocked(registerPasskey).mockResolvedValue({ ok: true });
});

afterEach(() => {
  resetPromptMemoryForTests();
  vi.clearAllMocks();
});

describe('EnablePasskeyPrompt', () => {
  it('offers enrollment when the account has no passkey yet', () => {
    vi.mocked(useAuth).mockReturnValue(sessionWith(false));
    render(<EnablePasskeyPrompt />);
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('stays hidden when a passkey is already registered', () => {
    vi.mocked(useAuth).mockReturnValue(sessionWith(true));
    const { container } = render(<EnablePasskeyPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden on devices without passkey support', () => {
    vi.mocked(useAuth).mockReturnValue(sessionWith(false));
    vi.mocked(passkeysSupported).mockReturnValue(false);
    const { container } = render(<EnablePasskeyPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('runs enrollment on Enable and surfaces failures', async () => {
    vi.mocked(useAuth).mockReturnValue(sessionWith(false));
    vi.mocked(registerPasskey).mockResolvedValueOnce({ ok: false, message: 'No passkey today.' });
    const user = userEvent.setup();
    render(<EnablePasskeyPrompt />);

    await user.click(screen.getByRole('button', { name: 'Enable' }));

    expect(vi.mocked(registerPasskey)).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('No passkey today.');
    });
  });

  it('dismisses for the visit via Not now', async () => {
    vi.mocked(useAuth).mockReturnValue(sessionWith(false));
    const user = userEvent.setup();
    const { container } = render(<EnablePasskeyPrompt />);

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(container).toBeEmptyDOMElement();
    expect(vi.mocked(registerPasskey)).not.toHaveBeenCalled();
  });
});
