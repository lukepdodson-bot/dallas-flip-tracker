import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, clearToken, hasToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(hasToken());

  const refresh = useCallback(async () => {
    if (!hasToken()) { setUser(null); setLoading(false); return null; }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
      return data;
    } catch {
      clearToken();
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const register = async payload => {
    const { data } = await api.post('/auth/register', payload);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => { clearToken(); setUser(null); };

  const is = role => Boolean(user?.roles?.includes(role));

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh, is }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
