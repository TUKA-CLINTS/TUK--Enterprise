// Session management: sign in / register / sign out and the cached profile.
// The profile is cached in localStorage so the app keeps working offline
// after the first successful sign-in.
import { api, getToken, setToken, clearToken } from './api.js';

const USER_KEY = 'tukent_user';

let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
} catch (e) {
  currentUser = null;
}

export function getUser() {
  return currentUser;
}

export function isSignedIn() {
  return !!getToken() && !!currentUser;
}

export function isAdmin() {
  return !!currentUser && currentUser.role === 'admin';
}

// Department access: admins see everything, everyone else sees their own.
export function canAccess(department) {
  return !!currentUser && (currentUser.role === 'admin' || currentUser.department === department);
}

// Account management is admin-only: the admin controls every department's accounts.
export function canManageEmployees() {
  return isAdmin();
}

function setSession({ token, user }) {
  setToken(token);
  currentUser = user;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function register(payload) {
  const data = await api.register(payload);
  setSession(data);
  return data.user;
}

export async function login(email, password) {
  const data = await api.login(email, password);
  setSession(data);
  return data.user;
}

// Refresh the cached profile from the server.
// Session is only cleared when the server explicitly rejects the token;
// offline failures keep the cached session alive.
export async function refreshProfile() {
  try {
    const data = await api.me();
    currentUser = data.user;
    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
    return currentUser;
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      clearSession();
    }
    return currentUser;
  }
}

export function clearSession() {
  clearToken();
  localStorage.removeItem(USER_KEY);
  currentUser = null;
}

export function logout() {
  clearSession();
  window.location.href = 'index.html';
}
