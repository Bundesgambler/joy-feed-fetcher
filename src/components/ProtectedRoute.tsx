import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const cookieValue = getCookie('app_auth');
  console.log('ProtectedRoute document.cookie:', document.cookie);
  console.log('ProtectedRoute app_auth:', cookieValue);

  const isAuthenticated = cookieValue === 'true';

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};
