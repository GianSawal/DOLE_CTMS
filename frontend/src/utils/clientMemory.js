import { useState } from 'react';

// Per-phone conveniences for clients: the language they chose and their latest ticket.
// Storage can be unavailable (private mode): everything still works, just without memory.
const LANG_KEY = 'ctms_client_lang';
const TICKET_KEY = 'ctms_last_ticket';

function get(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function set(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
}

/** The client's language, kept between the check-in page and their ticket. */
export function useClientLang() {
  const [lang, setLangState] = useState(() => (get(LANG_KEY) === 'fil' ? 'fil' : 'en'));
  const setLang = (next) => {
    setLangState(next);
    set(LANG_KEY, next);
  };
  return [lang, setLang];
}

// A device signed in as staff or a registration desk is shared by many clients
function isSharedDevice() {
  return Boolean(get('ctms_user'));
}

/** Remembers the client's ticket on their phone, so scanning the QR again offers it back. */
export function rememberTicket(ticketToken, officeId) {
  if (isSharedDevice()) return;
  set(TICKET_KEY, JSON.stringify({ token: ticketToken, officeId: String(officeId) }));
}

export function forgetTicket(ticketToken) {
  const saved = lastTicket();
  if (saved && saved.token === ticketToken) set(TICKET_KEY, null);
}

/** { token, officeId } of the ticket last opened on this phone, or null. */
export function lastTicket() {
  try {
    const saved = JSON.parse(get(TICKET_KEY) || 'null');
    return saved && saved.token ? saved : null;
  } catch {
    return null;
  }
}
