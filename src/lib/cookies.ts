const isBrowser = typeof document !== 'undefined';

export const AUTH_COOKIE_NAME = 'app_auth';
export const AUTH_TOKEN_NAME = 'app_token';
export const AUTH_COOKIE_EXPIRY_DAYS = 180;

export function getCookie(name: string): string | null {
  if (!isBrowser) return null;
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export function setCookie(name: string, value: string, days: number) {
  if (!isBrowser) return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; expires=${expires}; path=/; SameSite=Lax${secure}`;
}

export function deleteCookie(name: string) {
  if (!isBrowser) return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

// Get the auth token
export function getAuthToken(): string | null {
  return getCookie(AUTH_TOKEN_NAME);
}

// Set the auth token
export function setAuthToken(token: string) {
  setCookie(AUTH_TOKEN_NAME, token, AUTH_COOKIE_EXPIRY_DAYS);
  // Also set the legacy cookie for backwards compatibility
  setCookie(AUTH_COOKIE_NAME, 'true', AUTH_COOKIE_EXPIRY_DAYS);
}

// Clear all auth data
export function clearAuth() {
  deleteCookie(AUTH_COOKIE_NAME);
  deleteCookie(AUTH_TOKEN_NAME);
}
