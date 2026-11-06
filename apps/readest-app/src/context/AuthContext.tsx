'use client';

import { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const login = useCallback((_newToken: string, _newUser: User) => {}, []);
  const logout = useCallback(async () => {}, []);
  const refresh = useCallback(async () => false, []);

  const value = useMemo(
    () => ({ token: null, user: null, login, logout, refresh }),
    [login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
