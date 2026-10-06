import { apiRequest } from './client';

export const staffApi = {
  login: (username, password) => apiRequest('/staff/auth/login/', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  getMe: () => apiRequest('/staff/auth/me/'),

  getQueue: (officeId, counterId, assignedToMe = null) => {
    const params = new URLSearchParams();
    if (officeId) params.append('office', officeId);
    if (counterId) params.append('counter', counterId);
    if (assignedToMe !== null && assignedToMe !== undefined) params.append('assigned_to_me', assignedToMe);
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

  notifyPersonnel: (id) => apiRequest(`/staff/transactions/${id}/notify/`, {
    method: 'POST',
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

  getQrConfig: (officeId) => apiRequest(`/staff/qr-config/?office=${officeId}`),

  toggleQrConfig: (officeId, isQrEnabled, disabledMessage) => apiRequest('/staff/qr-config/toggle/', {
    method: 'POST',
    body: JSON.stringify({
      office_id: officeId,
      is_qr_enabled: isQrEnabled,
      disabled_message: disabledMessage,
    }),
  }),

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

  // Services Management & Personnel Assignment (Accessible to all accounts)
  getServices: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.append(k, v);
    });
    return apiRequest(`/staff/services/?${params.toString()}`);
  },

  getServicesSummary: () => apiRequest('/staff/services/summary/'),

  getService: (id) => apiRequest(`/staff/services/${id}/`),

  getServiceEligiblePersonnel: (id, filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.append(k, v);
    });
    return apiRequest(`/staff/services/${id}/eligible-personnel/?${params.toString()}`);
  },

  assignServicePersonnel: (id, personnelIds) => apiRequest(`/staff/services/${id}/assign-personnel/`, {
    method: 'POST',
    body: JSON.stringify({ personnel_ids: personnelIds }),
  }),

  // Employee & User Management (Admin Only)
  getOffices: () => apiRequest('/staff/offices/'),

  getPersonnel: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.append(k, v);
    });
    return apiRequest(`/staff/personnel/?${params.toString()}`);
  },

  createPersonnel: (data) => apiRequest('/staff/personnel/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  updatePersonnel: (id, data) => apiRequest(`/staff/personnel/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),

  deletePersonnel: (id) => apiRequest(`/staff/personnel/${id}/`, {
    method: 'DELETE',
  }),

  togglePersonnelActive: (id) => apiRequest(`/staff/personnel/${id}/toggle-active/`, {
    method: 'POST',
  }),

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

  changePassword: (newPassword, confirmPassword, currentPassword = '') => apiRequest('/staff/auth/change-password/', {
    method: 'POST',
    body: JSON.stringify({
      new_password: newPassword,
      confirm_password: confirmPassword,
      current_password: currentPassword,
    }),
  }),

  // Audit Logs (Admin Only)
  getAuditLogs: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.append(k, v);
    });
    return apiRequest(`/staff/audit-logs/?${params.toString()}`);
  },

  // Real-time Staff Notifications
  getNotifications: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.append(k, v);
    });
    return apiRequest(`/staff/notifications/?${params.toString()}`);
  },

  markAllNotificationsRead: () => apiRequest('/staff/notifications/', {
    method: 'POST',
    body: JSON.stringify({ action: 'mark_all_read' }),
  }),

  markNotificationRead: (id) => apiRequest('/staff/notifications/', {
    method: 'POST',
    body: JSON.stringify({ action: 'mark_read', id }),
  }),
};

