import { apiRequest } from './client';

export const publicApi = {
  getOfficeDetail: (officeId) => apiRequest(`/public/offices/${officeId}/`),
  checkin: (data) => apiRequest('/public/checkin/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getTicket: (ticketToken) => apiRequest(`/public/tickets/${ticketToken}/`),
  getDisplayBoard: (officeId, divisions = '') => {
    const query = divisions ? `?divisions=${encodeURIComponent(divisions)}` : '';
    return apiRequest(`/public/display/${officeId}/${query}`);
  },
  uploadDisplayVideo: (officeId, file) => {
    const formData = new FormData();
    formData.append('video_file', file);
    return apiRequest(`/public/display-video-upload/${officeId}/`, {
      method: 'POST',
      body: formData,
    });
  },
};
