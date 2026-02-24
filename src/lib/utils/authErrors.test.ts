import { describe, expect, it } from 'vitest';
import { AUTH_EXPIRED_PREFIX, extractAuthExpiredMessage } from './authErrors';

describe('auth error utilities', () => {
  it('extracts guided re-auth message from prefixed error', () => {
    const message = `${AUTH_EXPIRED_PREFIX} GitHub session expired while pushing. Sign in again.`;
    expect(extractAuthExpiredMessage(message)).toBe('GitHub session expired while pushing. Sign in again.');
  });

  it('falls back to default message when prefix has no details', () => {
    expect(extractAuthExpiredMessage(`${AUTH_EXPIRED_PREFIX}   `)).toBe(
      'GitHub session expired. Sign in again to continue.'
    );
  });

  it('returns null for non-auth-expired errors', () => {
    expect(extractAuthExpiredMessage('clone failed: network error')).toBeNull();
    expect(extractAuthExpiredMessage(null)).toBeNull();
    expect(extractAuthExpiredMessage(undefined)).toBeNull();
  });
});
