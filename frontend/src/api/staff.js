import { apiRequest } from './client';

export const staffApi = {
  login: (username, password) => apiRequest('/staff/auth/login/', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  getMe: () => apiRequest('/staff/auth/me/'),

  getQueue: (officeId, counterId) => {
    const params = new URLSearchParams();
    if (officeId) params.append('office', officeId);
    if (counterId) params.append('counter', counterId);
    return apiRequest(`/staff/queue/?${params.toString()}`);
  },

  getDivisions: () => apiRequest('/staff/divisions/'),

  callNext: (officeId, counterId, personnel = null) => apiRequest('/staff/call-next/', {
    method: 'POST',
    body: JSON.stringify({ office: officeId, counter: counterId, personnel }),
  }),

  assignPersonnel: (id, personnel) => apiRequest(`/staff/transactions/${id}/assign/`, {
    method: 'POST',
    body: JSON.stringify({ personnel }),
  }),

  createWalkin: (data) => apiRequest('/staff/transactions/walkin/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  transactionAction: (id, action, payload = {}) => apiRequest(`/staff/transactions/${id}/${action}/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  getTransactions: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.append(k, v);
    });
    return apiRequest(`/staff/transactions/?${params.toString()}`);
  },

  getReportsSummary: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.append(k, v);
    });
    return apiRequest(`/staff/reports/summary/?${params.toString()}`);
  },

  getQrCodeUrl: (officeId) => `/api/staff/qr/${officeId}/`,

  getDisplayVideo: (officeId) => apiRequest(`/staff/display-video/?office=${officeId}`),

  updateDisplayVideo: (officeId, artaVideoUrl, isActive = true) => apiRequest('/staff/display-video/', {
    method: 'POST',
    body: JSON.stringify({ office: officeId, arta_video_url: artaVideoUrl, is_active: isActive }),
  }),

  uploadDisplayVideoFile: (officeId, file, isActive = true) => {
    const formData = new FormData();
    formData.append('office', officeId);
    formData.append('video_file', file);
    formData.append('is_active', isActive);
    return apiRequest('/staff/display-video/', {
      method: 'POST',
      body: formData,
    });
  },

  clearDisplayVideo: (officeId) => apiRequest('/staff/display-video/', {
    method: 'POST',
    body: JSON.stringify({ office: officeId, arta_video_url: '', clear_file: true, is_active: false }),
  }),

  // Employee & User Management (Admin Only)
  getOffices: () => apiRequest('/staff/offices/'),

  getEmployees: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.append(k, v);
    });
    return apiRequest(`/staff/users/?${params.toString()}`);
  },

  createEmployee: (data) => apiRequest('/staff/users/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  updateEmployee: (id, data) => apiRequest(`/staff/users/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),

  deleteEmployee: (id) => apiRequest(`/staff/users/${id}/`, {
    method: 'DELETE',
  }),

  resetEmployeePassword: (id, password = null) => apiRequest(`/staff/users/${id}/reset-password/`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),

  toggleEmployeeActive: (id) => apiRequest(`/staff/users/${id}/toggle-active/`, {
    method: 'POST',
  }),
};

