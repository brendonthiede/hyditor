export const AUTH_EXPIRED_PREFIX = 'AUTH_EXPIRED:';

const RECOVERY_ERROR_PATTERNS = [
  /session expired/i,
  /refresh token/i,
  /token invalid/i,
  /token revoked/i,
  /invalid_grant/i,
  /reauth/i,
  /sign in again/i
];

export function extractAuthExpiredMessage(rawMessage?: string | null): string | null {
  if (!rawMessage) {
    return null;
  }

  const trimmed = rawMessage.trim();
  if (!trimmed.startsWith(AUTH_EXPIRED_PREFIX)) {
    return null;
  }

  const detail = trimmed.slice(AUTH_EXPIRED_PREFIX.length).trim();
  return detail.length > 0 ? detail : 'GitHub session expired. Sign in again to continue.';
}

export function shouldShowLocalSessionRecovery(rawMessage?: string | null): boolean {
  if (!rawMessage) {
    return false;
  }

  return RECOVERY_ERROR_PATTERNS.some((pattern) => pattern.test(rawMessage));
}
