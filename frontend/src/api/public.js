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
  uploadDisplayVideo: (officeId, file) => {
    const formData = new FormData();
    formData.append('video_file', file);
    return apiRequest(`/public/display-video-upload/${officeId}/`, {
      method: 'POST',
      body: formData,
    });
  },
};
