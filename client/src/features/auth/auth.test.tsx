import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterPage } from './RegisterPage';
import { LoginPage } from './LoginPage';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';

const meta = { success: true, data: { currencies: { featured: ['GHS', 'USD'], all: ['GHS', 'USD', 'EUR'] }, legal: { termsVersion: 'x', privacyVersion: 'y' } } };

beforeEach(() => {
  useAuth.getState().clear();
  vi.restoreAllMocks();
});

describe('RegisterPage', () => {
  it('blocks submission until required consent is given and the password is strong', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(meta));
    renderWithProviders(<RegisterPage />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Full name'), 'Akosua Owusu');
    await user.type(screen.getByLabelText('Email'), 'akosua@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(screen.getByText('Accept the terms to continue.')).toBeInTheDocument();
    expect(screen.getByText('Accept the privacy notice to continue.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    // Only the currency list was fetched; nothing was posted.
    expect(fetchMock.mock.calls.every(([url]) => String(url) === '/api/meta')).toBe(true);
  });

  it('defaults the currency to GHS and leaves marketing unticked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(meta));
    renderWithProviders(<RegisterPage />);
    expect(screen.getByLabelText('Main currency')).toHaveValue('GHS');
    expect(screen.getByLabelText(/product updates/i)).not.toBeChecked();
  });

  it('shows server field errors next to the right field', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url) === '/api/meta') return jsonResponse(meta);
      return jsonResponse(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ location: 'body', field: 'email', message: 'Email is not allowed.' }] } },
        422,
      );
    });
    renderWithProviders(<RegisterPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Full name'), 'Akosua Owusu');
    await user.type(screen.getByLabelText('Email'), 'akosua@example.com');
    await user.type(screen.getByLabelText('Password'), 'long enough 123');
    await user.click(screen.getByLabelText(/terms of use/i));
    await user.click(screen.getByLabelText(/privacy notice/i));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Email is not allowed.')).toBeInTheDocument();
  });
});

describe('LoginPage', () => {
  it('shows the server message on bad credentials and keeps the user signed out', async () => {
    // A fresh response per request: the sign-in page also asks for /api/meta.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input) === '/api/meta'
        ? jsonResponse({ success: true, data: { currencies: { featured: ['GHS'], all: ['GHS'] }, legal: { termsVersion: 'x', privacyVersion: 'y' }, stage: 'live', demo: null } })
        : jsonResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'Email or password is incorrect.' } }, 401),
    );
    renderWithProviders(<LoginPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'kofi@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    expect(useAuth.getState().status).toBe('guest');
  });
});
