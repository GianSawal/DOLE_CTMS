import { apiRequest } from './client';

// Fetches a backup file and hands it to the browser as a download
async function saveBackupFile(url, options) {
  await apiRequest('/staff/backups/');  // renews the sign-in first if it has expired
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ctms_access_token')}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'The backup could not be downloaded.');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'ctms-backup.ctmsbak';
  const href = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
  return name;
}

export const staffApi = {
  login: (username, password, remember = false) => apiRequest('/staff/auth/login/', {
    method: 'POST',
    body: JSON.stringify({ username, password, remember }),
  }),
  getMe: () => apiRequest('/staff/auth/me/'),

  // Two-factor sign-in (Google / Microsoft Authenticator). `challenge` comes from login.
  twoFactorSetup: (challenge) => apiRequest('/staff/auth/2fa/setup/', {
    method: 'POST',
    body: JSON.stringify({ challenge }),
  }),
  twoFactorVerify: (challenge, code) => apiRequest('/staff/auth/2fa/verify/', {
    method: 'POST',
    body: JSON.stringify({ challenge, code }),
  }),
  getTwoFactor: () => apiRequest('/staff/auth/2fa/'),
  newBackupCodes: (code) => apiRequest('/staff/auth/2fa/', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  resetEmployeeTwoFactor: (id) => apiRequest(`/staff/users/${id}/reset-2fa/`, { method: 'POST' }),

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

  // Registration desk: its office and the number of clients waiting
  getRegistrationDesk: () => apiRequest('/staff/registration/'),

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

  // Every other sign-in of the account ends; this browser gets a fresh one back
  changePassword: async (newPassword, confirmPassword, currentPassword = '') => {
    const res = await apiRequest('/staff/auth/change-password/', {
      method: 'POST',
      body: JSON.stringify({
        new_password: newPassword,
        confirm_password: confirmPassword,
        current_password: currentPassword,
        refresh: localStorage.getItem('ctms_refresh_token'),  // keeps "Remember me"
      }),
    });
    if (res?.access) localStorage.setItem('ctms_access_token', res.access);
    if (res?.refresh) localStorage.setItem('ctms_refresh_token', res.refresh);
    return res;
  },

  // Backups (system administrator only)
  getBackupInfo: () => apiRequest('/staff/backups/'),
  // Makes an encrypted backup and saves it as a file in the browser's downloads. With the
  // server's .env passphrase set, passphrase can be left empty.
  downloadBackup: (contents, passphrase = '', confirmPassphrase = '') => saveBackupFile('/api/staff/backups/', {
    method: 'POST',
    body: JSON.stringify({ contents, passphrase, confirm_passphrase: confirmPassphrase }),
  }),
  // Downloads one of the nightly backups kept on the server
  downloadStoredBackup: (name) => saveBackupFile(`/api/staff/backups/${encodeURIComponent(name)}/`, { method: 'GET' }),

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
  // A client referred here has arrived: they join this office's line now
  markReferralArrived: (id) => apiRequest(`/staff/referrals/${id}/arrived/`, { method: 'POST' }),
  // Sends the client to another office (they join its line on arrival); `note` (the client's concern) is required
  referTransaction: (id, toOffice, note, service = null) => apiRequest(`/staff/transactions/${id}/refer/`, {
    method: 'POST',
    body: JSON.stringify({ to_office: toOffice, note, service }),
  }),
  getTransactionHistory: (id) => apiRequest(`/staff/transactions/${id}/history/`),

  // Windows (office-scoped service windows)
  getWindows: (officeId) => {
    const params = new URLSearchParams();
    if (officeId) params.append('office', officeId);
    return apiRequest(`/staff/windows/?${params.toString()}`);
  },
  createWindow: (officeId, name, description = '') => apiRequest('/staff/windows/', {
    method: 'POST',
    body: JSON.stringify({ office: officeId, name, description }),
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

