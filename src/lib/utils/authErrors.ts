export const AUTH_EXPIRED_PREFIX = 'AUTH_EXPIRED:';

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
