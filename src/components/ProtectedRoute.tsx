import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AUTH_COOKIE_NAME, getCookie } from '@/lib/cookies';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const cookieValue = getCookie(AUTH_COOKIE_NAME);
    console.log(
      'ProtectedRoute check - document.cookie:',
      typeof document !== 'undefined' ? document.cookie : 'no document'
    );
    console.log('ProtectedRoute check - app_auth:', cookieValue);

    setIsAuthenticated(cookieValue === 'true');
    setIsChecking(false);
  }, []);

  if (isChecking) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};
