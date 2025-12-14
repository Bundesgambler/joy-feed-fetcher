import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { getAuthToken, setAuthToken } from '@/lib/cookies';

const Login = () => {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Redirect if already authenticated with valid token
  useEffect(() => {
    const checkAuth = async () => {
      const token = getAuthToken();
      if (token) {
        try {
          const { data } = await supabase.functions.invoke('validate-token', {
            body: { token },
          });
          if (data?.valid) {
            navigate('/', { replace: true });
          }
        } catch (error) {
          console.error('Token validation error:', error);
        }
      }
    };
    checkAuth();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password.trim()) {
      toast({ title: 'Please enter password', variant: 'destructive' });
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('verify-password', {
        body: { password },
      });

      if (error) throw error;

      if (data.success && data.token) {
        setAuthToken(data.token);
        window.location.href = '/';
      } else if (data.error) {
        toast({ 
          title: data.error, 
          description: data.retryAfter ? `Try again in ${Math.ceil(data.retryAfter / 60)} minutes` : undefined,
          variant: 'destructive' 
        });
      } else {
        toast({ title: 'Invalid password', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Login error:', error);
      toast({ title: 'Login failed', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center">Login</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                disabled={isLoading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
