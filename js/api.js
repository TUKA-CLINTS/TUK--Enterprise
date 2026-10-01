// Thin fetch wrapper for the TUK@ Enterprises API.
// Every call attaches the stored session token; network failures are
// reported with err.offline = true so callers can fall back to local data.

const TOKEN_KEY = 'tukent_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function request(path, options = {}) {
  const { method = 'GET', body, auth = true } = options;
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    const err = new Error('Network unavailable');
    err.offline = true;
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) { /* non-JSON response body */ }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.offline = false;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => request('/api/auth/me'),

  listUsers: () => request('/api/users'),
  createUser: (payload) => request('/api/users', { method: 'POST', body: payload }),
  updateUser: (id, payload) => request(`/api/users/${id}`, { method: 'PUT', body: payload }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),

  pushOps: (ops) => request('/api/sync/push', { method: 'POST', body: { ops } }),
  pullChanges: (since) => request(`/api/sync/pull?since=${Number(since) || 0}`),

  // Account recovery (public "secret option" - no session needed)
  recoveryRequest: (email) => request('/api/recovery/request', { method: 'POST', body: { email }, auth: false }),
  recoveryVerifyCode: (requestId, code) => request('/api/recovery/verify-code', { method: 'POST', body: { requestId, code }, auth: false }),
  recoverySubmitDocument: (payload) => request('/api/recovery/submit-document', { method: 'POST', body: payload, auth: false }),
  recoveryReset: (requestId, password) => request('/api/recovery/reset', { method: 'POST', body: { requestId, password }, auth: false }),

  // Own recovery documents
  listRecoveryDocs: () => request('/api/recovery/documents'),
  saveRecoveryDoc: (payload) => request('/api/recovery/documents', { method: 'POST', body: payload }),
  deleteRecoveryDoc: (id) => request(`/api/recovery/documents/${id}`, { method: 'DELETE' }),

  // Admin panel
  adminActivity: (limit = 300) => request(`/api/admin/activity?limit=${limit}`),
  adminNotifications: (limit = 300) => request(`/api/admin/notifications?limit=${limit}`),
  adminRecoveryRequests: () => request('/api/admin/recovery-requests'),
  adminApproveRequest: (id) => request(`/api/admin/recovery-requests/${id}/approve`, { method: 'PUT' }),
  adminDenyRequest: (id) => request(`/api/admin/recovery-requests/${id}/deny`, { method: 'PUT' })
};
