import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, getToken, setToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    window.location.href = '/login';
  }, []);

  const can = useCallback(
    (permission) => {
      if (!user) return false;
      if (!permission) return true;
      const list = Array.isArray(permission) ? permission : [permission];
      return list.some((p) => user.permissions.includes(p));
    },
    [user]
  );

  /**
   * Every permission in the list, not just one of them. Some screens are only
   * usable when the user can read several things at once - the costing screen
   * needs both the costing permission and the production orders it analyses -
   * and offering it with one of the two produces an empty, broken page.
   */
  const canAll = useCallback(
    (permissions) => (permissions || []).every((p) => can(p)),
    [can]
  );

  const value = useMemo(
    () => ({ user, loading, login, logout, can, canAll }),
    [user, loading, login, logout, can, canAll]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
