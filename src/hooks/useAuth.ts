import { useState, useEffect } from 'react';

const AUTH_COOKIE_NAME = 'app_auth';
const COOKIE_EXPIRY_DAYS = 180;

export const useAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const cookie = getCookie(AUTH_COOKIE_NAME);
    setIsAuthenticated(cookie === 'true');
  }, []);

  const login = () => {
    setCookie(AUTH_COOKIE_NAME, 'true', COOKIE_EXPIRY_DAYS);
    setIsAuthenticated(true);
  };

  const logout = () => {
    deleteCookie(AUTH_COOKIE_NAME);
    setIsAuthenticated(false);
  };

  return { isAuthenticated, login, logout };
};

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Strict`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}
