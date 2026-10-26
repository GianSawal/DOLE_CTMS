// Referrals this phone is carrying to another office, so that office's check-in page can
// offer "Join the line" when the client scans its QR. Only a convenience: staff can also
// confirm the arrival, so losing this (private mode, cleared data) blocks nobody.
const KEY = 'ctms_pending_referrals';

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

export function rememberReferral(ticketToken, officeId) {
  const list = read().filter(r => r.token !== ticketToken);
  write([...list, { token: ticketToken, officeId: String(officeId) }]);
}

export function forgetReferral(ticketToken) {
  const list = read();
  if (list.some(r => r.token === ticketToken)) write(list.filter(r => r.token !== ticketToken));
}

/** Ticket tokens of referrals to `officeId` remembered on this phone. */
export function referralsTo(officeId) {
  return read().filter(r => r.officeId === String(officeId)).map(r => r.token);
}
