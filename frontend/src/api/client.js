const BASE_URL = '/api';

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
    try {
      const refreshRes = await fetch(`${BASE_URL}/staff/auth/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: localStorage.getItem('ctms_refresh_token') }),
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        localStorage.setItem('ctms_access_token', refreshData.access);
        headers['Authorization'] = `Bearer ${refreshData.access}`;
        // Retry original request
        const retryRes = await fetch(url, { ...options, headers });
        if (!retryRes.ok) {
          const err = await retryRes.json().catch(() => ({ detail: retryRes.statusText }));
          throw new Error(err.detail || 'Request failed');
        }
        return retryRes.json();
      } else {
        localStorage.removeItem('ctms_access_token');
        localStorage.removeItem('ctms_refresh_token');
        localStorage.removeItem('ctms_user');
      }
    } catch {
      localStorage.removeItem('ctms_access_token');
      localStorage.removeItem('ctms_refresh_token');
      localStorage.removeItem('ctms_user');
    }
  }

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: response.statusText }));
    const errorMsg = errorData.detail || (typeof errorData === 'object' ? Object.values(errorData).flat().join(', ') : 'Request failed');
    throw new Error(errorMsg);
  }

  return response.json();
}
