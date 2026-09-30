import React, { createContext, useContext, useState, useEffect } from 'react';
import { staffApi } from '../api/staff';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('ctms_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      const token = localStorage.getItem('ctms_access_token');
      if (token) {
        try {
          const profile = await staffApi.getMe();
          setUser(profile);
          localStorage.setItem('ctms_user', JSON.stringify(profile));
        } catch {
          logout();
        }
      }
      setLoading(false);
    }
    loadUser();
  }, []);

  const login = async (username, password) => {
    const data = await staffApi.login(username, password);
    localStorage.removeItem('ctms_staff_counter');
    localStorage.removeItem('ctms_staff_office');
    localStorage.removeItem('ctms_tv_division_filter');
    localStorage.setItem('ctms_access_token', data.access);
    localStorage.setItem('ctms_refresh_token', data.refresh);
    localStorage.setItem('ctms_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('ctms_access_token');
    localStorage.removeItem('ctms_refresh_token');
    localStorage.removeItem('ctms_user');
    localStorage.removeItem('ctms_staff_counter');
    localStorage.removeItem('ctms_staff_office');
    localStorage.removeItem('ctms_tv_division_filter');
    setUser(null);
  };

  const updateUser = (updates) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      localStorage.setItem('ctms_user', JSON.stringify(updated));
      return updated;
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
