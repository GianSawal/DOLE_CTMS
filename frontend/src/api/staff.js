import { apiRequest } from './client';

export const staffApi = {
  login: (username, password) => apiRequest('/staff/auth/login/', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  getMe: () => apiRequest('/staff/auth/me/'),

  getQueue: (officeId) => {
    const params = new URLSearchParams();
    if (officeId) params.append('office', officeId);
    return apiRequest(`/staff/queue/?${params.toString()}`);
  },

  getDivisions: () => apiRequest('/staff/divisions/'),

  // Calls the next client in the office's shared queue to the caller's window
  callNext: (officeId) => apiRequest('/staff/call-next/', {
    method: 'POST',
    body: JSON.stringify({ office: officeId }),
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

  // changes: { requires_office_code?, regenerate?, regenerate_display_key? }
  updateOfficeCode: (officeId, changes) => apiRequest('/staff/qr-config/office-code/', {
    method: 'POST',
    body: JSON.stringify({ office_id: officeId, ...changes }),
  }),

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

  // Service catalog (everyone reads; regional admins tag divisions)
  getServices: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.append(k, v);
    });
    return apiRequest(`/staff/services/?${params.toString()}`);
  },

  getServicesSummary: () => apiRequest('/staff/services/summary/'),

  setServiceDivision: (id, divisionId) => apiRequest(`/staff/services/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ division: divisionId }),
  }),

  // User Management (regional administrators)
  getOffices: () => apiRequest('/staff/offices/'),

  // Positions catalog (regional administrators)
  getPositions: () => apiRequest('/staff/positions/'),
  createPosition: (data) => apiRequest('/staff/positions/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  deletePosition: (id) => apiRequest(`/staff/positions/${id}/`, {
    method: 'DELETE',
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

  resetEmployeePassword: (id, password, confirmPassword) => apiRequest(`/staff/users/${id}/reset-password/`, {
    method: 'POST',
    body: JSON.stringify({ password, confirm_password: confirmPassword }),
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

  // My Clients & reassignment
  getMyClients: (tab, q = '') => {
    const params = new URLSearchParams({ tab });
    if (q) params.append('q', q);
    return apiRequest(`/staff/my-clients/?${params.toString()}`);
  },
  getTransferRecipients: (id) => apiRequest(`/staff/transactions/${id}/transfer-recipients/`),
  transferTransaction: (id, toUser, reason = '') => apiRequest(`/staff/transactions/${id}/transfer/`, {
    method: 'POST',
    body: JSON.stringify({ to_user: toUser, reason }),
  }),
  getTransactionHistory: (id) => apiRequest(`/staff/transactions/${id}/history/`),

  // Windows (office-scoped service windows)
  getWindows: (officeId) => {
    const params = new URLSearchParams();
    if (officeId) params.append('office', officeId);
    return apiRequest(`/staff/windows/?${params.toString()}`);
  },
  createWindow: (officeId, name) => apiRequest('/staff/windows/', {
    method: 'POST',
    body: JSON.stringify({ office: officeId, name }),
  }),
  updateWindow: (id, data) => apiRequest(`/staff/windows/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  archiveWindow: (id) => apiRequest(`/staff/windows/${id}/`, {
    method: 'DELETE',
  }),
  assignMeToWindow: (id) => apiRequest(`/staff/windows/${id}/assign-me/`, {
    method: 'POST',
  }),
  releaseWindow: (id) => apiRequest(`/staff/windows/${id}/release/`, {
    method: 'POST',
  }),
};

