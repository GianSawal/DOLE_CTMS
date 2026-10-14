import { apiRequest } from './client';

export const publicApi = {
  getOfficeDetail: (officeId) => apiRequest(`/public/offices/${officeId}/`),
  checkin: (data) => apiRequest('/public/checkin/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getTicket: (ticketToken) => apiRequest(`/public/tickets/${ticketToken}/`),
  // `key` is the office's secret TV key; only with it does the board include the check-in code.
  getDisplayBoard: (officeId, key) => apiRequest(
    `/public/display/${officeId}/${key ? `?key=${encodeURIComponent(key)}` : ''}`
  ),
  // The TV's announcement feed: every call logged after `after` (no `after`: just the cursor)
  getDisplayCalls: (officeId, after) => apiRequest(
    `/public/display/${officeId}/calls/${after != null ? `?after=${after}` : ''}`
  ),
};
