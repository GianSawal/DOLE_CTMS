import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { staffApi } from '../api/staff';
import { SESSION_EXPIRED_EVENT } from '../api/client';

const AuthContext = createContext(null);

// Signed out after this long without mouse, keyboard, scroll or touch activity in any tab,
// unless "Remember me" was checked at sign-in. TV Display accounts are never signed out.
export const IDLE_LIMIT_MS = 60 * 60 * 1000;
const IDLE_CHECK_MS = 30 * 1000;
const ACTIVITY_SAVE_MS = 10 * 1000;  // how often activity is written (shared by all tabs)
const ACTIVITY_KEY = 'ctms_last_activity';
const REMEMBER_KEY = 'ctms_remember';
export const LOGOUT_REASON_KEY = 'ctms_logout_reason';
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'];

const SESSION_KEYS = [
  'ctms_access_token', 'ctms_refresh_token', 'ctms_user', 'ctms_staff_counter', 'ctms_staff_office',
  'ctms_tv_division_filter', 'ctms_tv_selected_divisions', ACTIVITY_KEY, REMEMBER_KEY,
];

function readSavedUser() {
  try {
    const saved = localStorage.getItem('ctms_user');
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function idleSignOutApplies(user) {
  return Boolean(user) && user.role !== 'DISPLAY' && localStorage.getItem(REMEMBER_KEY) !== '1';
}

function idleTooLong() {
  const last = Number(localStorage.getItem(ACTIVITY_KEY) || 0);
  return last > 0 && Date.now() - last > IDLE_LIMIT_MS;
}

function clearSession(reason) {
  // Revoke the refresh token on the server so a copy of it can't be used later
  const refresh = localStorage.getItem('ctms_refresh_token');
  if (refresh) {
    fetch('/api/staff/auth/logout/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
      keepalive: true,
    }).catch(() => {});
  }
  SESSION_KEYS.forEach(key => localStorage.removeItem(key));
  if (reason) {
    try { sessionStorage.setItem(LOGOUT_REASON_KEY, reason); } catch {}
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = readSavedUser();
    // Away for over an hour (e.g. the browser was closed): start signed out
    if (saved && idleSignOutApplies(saved) && idleTooLong()) {
      clearSession('idle');
      return null;
    }
    return saved;
  });
  const [loading, setLoading] = useState(true);

  const logout = useCallback((reason) => {
    clearSession(typeof reason === 'string' ? reason : null);
    setUser(null);
  }, []);

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
  }, [logout]);

  // The API helper could not renew the sign-in: show the login page
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Signed out in another tab (by hand or for inactivity): sign out here too
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'ctms_access_token' && !e.newValue) setUser(null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Inactivity sign-out (not with "Remember me", not for TV accounts)
  const idleWatch = idleSignOutApplies(user);
  useEffect(() => {
    if (!idleWatch) return undefined;
    let lastSaved = 0;
    const markActive = () => {
      const now = Date.now();
      if (now - lastSaved < ACTIVITY_SAVE_MS) return;
      lastSaved = now;
      localStorage.setItem(ACTIVITY_KEY, String(now));
    };
    const check = () => {
      if (idleTooLong()) logout('idle');
    };
    markActive();
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, markActive, { passive: true }));
    // Also check right away when the screen is shown again (e.g. the computer wakes up)
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, IDLE_CHECK_MS);
    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, markActive));
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, [idleWatch, logout]);

  const login = async (username, password, remember = false) => {
    const data = await staffApi.login(username, password, remember);
    localStorage.removeItem('ctms_staff_counter');
    localStorage.removeItem('ctms_staff_office');
    localStorage.removeItem('ctms_tv_division_filter');
    localStorage.removeItem('ctms_tv_selected_divisions');
    localStorage.setItem('ctms_access_token', data.access);
    localStorage.setItem('ctms_refresh_token', data.refresh);
    localStorage.setItem('ctms_user', JSON.stringify(data.user));
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    if (remember) localStorage.setItem(REMEMBER_KEY, '1');
    else localStorage.removeItem(REMEMBER_KEY);
    setUser(data.user);
    return data.user;
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
