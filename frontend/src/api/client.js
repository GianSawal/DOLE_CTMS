const BASE_URL = '/api';

// Fired when the sign-in can no longer be renewed, so the app returns to the login page
// instead of leaving a page open whose every request now fails.
export const SESSION_EXPIRED_EVENT = 'ctms:session-expired';

function clearSession() {
  localStorage.removeItem('ctms_access_token');
  localStorage.removeItem('ctms_refresh_token');
  localStorage.removeItem('ctms_user');
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

// One renewal at a time: requests that expire together wait for the same one. Each renewal
// replaces the refresh token (the old one stops working), so the new one must be kept.
let renewing = null;

function renewSignIn() {
  if (!renewing) {
    renewing = (async () => {
      const res = await fetch(`${BASE_URL}/staff/auth/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: localStorage.getItem('ctms_refresh_token') }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.refresh) localStorage.setItem('ctms_refresh_token', data.refresh);
      return data.access || null;
    })().finally(() => { renewing = null; });
  }
  return renewing;
}

async function toError(response) {
  const errorData = await response.json().catch(() => ({ detail: response.statusText }));
  const errorMsg = errorData.detail || (typeof errorData === 'object' ? Object.values(errorData).flat().join(', ') : 'Request failed');
  const error = new Error(errorMsg);
  // Callers branch on the server's error `code` (e.g. QR_DISABLED, OFFICE_CODE_INVALID)
  error.status = response.status;
  error.data = errorData;
  return error;
}

export async function apiRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };

  const token = localStorage.getItem('ctms_access_token');
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (err) {
    if (err.name === 'TypeError' && (err.message === 'Failed to fetch' || err.message.includes('fetch'))) {
      throw new Error('Connection failed or file upload exceeded server limit (HTTP 413). Please ensure server is running and file is within size limits.');
    }
    throw err;
  }

  // Handle 413 Payload Too Large explicitly
  if (response.status === 413) {
    throw new Error('The video file is too large for the server. Maximum allowed size is 300MB.');
  }

  // Handle 401 token refresh if needed
  if (response.status === 401 && localStorage.getItem('ctms_refresh_token')) {
    let newAccess = null;
    try {
      newAccess = await renewSignIn();
    } catch {
      // Network problem while renewing: keep the session, the request just fails below
      throw new Error('Connection failed. Please check the network and try again.');
    }
    if (newAccess) {
      localStorage.setItem('ctms_access_token', newAccess);
      headers['Authorization'] = `Bearer ${newAccess}`;
      // Retry the original request (its errors keep their status and code, like any other)
      response = await fetch(url, { ...options, headers });
    } else {
      clearSession();  // the sign-in can't be renewed (expired or revoked)
    }
  }

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw await toError(response);
  }

  return response.json();
}
