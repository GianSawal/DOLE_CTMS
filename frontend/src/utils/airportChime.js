/**
 * Airport Announcement Chime Synthesizer & Voice Announcer (Web Audio API & Web Speech API)
 *
 * Implements:
 * 1. Acoustic simulation of physical metal chime bars (tubular bells)
 *    commonly used in international airport Public Address (PA) and gate announcement systems.
 * 2. Automatic voice announcements via Web Speech API:
 *    "Now serving, queue number [queue_no] at [counter]. Please look for [personnel]."
 * 3. Cross-tab real-time announcement bus via BroadcastChannel.
 */

let sharedAudioCtx = null;

export const CHIME_BROADCAST_CHANNEL = 'dole_ctms_queue_chime';

export function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
  }
  return sharedAudioCtx;
}

export async function unlockAudioContext() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
    // Also warm up SpeechSynthesis voices
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }
    return ctx?.state === 'running';
  } catch {
    return false;
  }
}

export function isAudioUnlocked() {
  return Boolean(sharedAudioCtx && sharedAudioCtx.state === 'running');
}

/**
 * Broadcasts a call/recall event across open browser tabs/windows.
 */
export function broadcastQueueCall(payload = {}) {
  try {
    const callId = `${payload.queueNo || ''}_${payload.counter || ''}_${Date.now()}`;
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(CHIME_BROADCAST_CHANNEL);
      bc.postMessage({
        type: 'QUEUE_CALLED',
        timestamp: Date.now(),
        callId,
        ...payload,
      });
      bc.close();
    }
    // Also dispatch to localStorage as an extra cross-window fallback
    try {
      localStorage.setItem('dole_last_queue_call', JSON.stringify({
        timestamp: Date.now(),
        callId,
        ...payload,
      }));
    } catch {}
  } catch (err) {
    console.debug('broadcastQueueCall notice:', err);
  }
}

/**
 * Chime Presets:
 * 1. classic4: Iconic 4-tone ascending major chime (F4 -> A4 -> C5 -> F5).
 *    Universally recognized in premier international airports (Changi, Haneda, Heathrow).
 * 2. classic3: Crisp 3-tone ascending chime (C5 -> G5 -> C6).
 */
export const CHIME_PRESETS = {
  classic4: {
    id: 'classic4',
    name: 'Airport Chime (4-Tone Ascending)',
    notes: [
      { freq: 349.23, delay: 0.00, duration: 0.90, gain: 0.32 }, // F4
      { freq: 440.00, delay: 0.28, duration: 0.90, gain: 0.34 }, // A4
      { freq: 523.25, delay: 0.56, duration: 1.00, gain: 0.36 }, // C5
      { freq: 698.46, delay: 0.84, duration: 1.75, gain: 0.40 }, // F5 (lingering chord resolution)
    ],
  },
  classic3: {
    id: 'classic3',
    name: 'Airport Chime (3-Tone)',
    notes: [
      { freq: 523.25, delay: 0.00, duration: 0.95, gain: 0.32 }, // C5
      { freq: 783.99, delay: 0.35, duration: 0.95, gain: 0.35 }, // G5
      { freq: 1046.50, delay: 0.70, duration: 1.70, gain: 0.40 }, // C6
    ],
  },
};

/**
 * Plays the airport announcement chime.
 * @param {string} presetKey - 'classic4' (default) or 'classic3'
 */
export async function playAirportChime(presetKey = 'classic4') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    const preset = CHIME_PRESETS[presetKey] || CHIME_PRESETS.classic4;
    const now = ctx.currentTime;

    // Master volume control
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.9, now);
    masterGain.connect(ctx.destination);

    preset.notes.forEach(({ freq, delay, duration, gain: noteGain }) => {
      const startTime = now + delay;
      const endTime = startTime + duration;

      // 1. Primary fundamental tone: pure sinusoidal acoustic chime
      const oscPrimary = ctx.createOscillator();
      const gainPrimary = ctx.createGain();
      oscPrimary.type = 'sine';
      oscPrimary.frequency.setValueAtTime(freq, startTime);

      // Percussive mallet strike: rapid 6ms attack followed by smooth exponential decay
      gainPrimary.gain.setValueAtTime(0.0001, startTime);
      gainPrimary.gain.exponentialRampToValueAtTime(noteGain, startTime + 0.006);
      gainPrimary.gain.exponentialRampToValueAtTime(0.0001, endTime);

      oscPrimary.connect(gainPrimary);
      gainPrimary.connect(masterGain);

      oscPrimary.start(startTime);
      oscPrimary.stop(endTime);

      // 2. High metallic chime overtone (~2.76x physical chime bar inharmonic mode)
      const oscOvertone = ctx.createOscillator();
      const gainOvertone = ctx.createGain();
      oscOvertone.type = 'sine';
      oscOvertone.frequency.setValueAtTime(freq * 2.76, startTime);

      const overtoneDuration = duration * 0.40;
      gainOvertone.gain.setValueAtTime(0.0001, startTime);
      gainOvertone.gain.exponentialRampToValueAtTime(noteGain * 0.18, startTime + 0.004);
      gainOvertone.gain.exponentialRampToValueAtTime(0.0001, startTime + overtoneDuration);

      oscOvertone.connect(gainOvertone);
      gainOvertone.connect(masterGain);

      oscOvertone.start(startTime);
      oscOvertone.stop(startTime + overtoneDuration);

      // 3. Octave harmonic (2.0x) for warmth and rich body
      const oscOctave = ctx.createOscillator();
      const gainOctave = ctx.createGain();
      oscOctave.type = 'sine';
      oscOctave.frequency.setValueAtTime(freq * 2.0, startTime);

      const octaveDuration = duration * 0.55;
      gainOctave.gain.setValueAtTime(0.0001, startTime);
      gainOctave.gain.exponentialRampToValueAtTime(noteGain * 0.14, startTime + 0.005);
      gainOctave.gain.exponentialRampToValueAtTime(0.0001, startTime + octaveDuration);

      oscOctave.connect(gainOctave);
      gainOctave.connect(masterGain);

      oscOctave.start(startTime);
      oscOctave.stop(startTime + octaveDuration);
    });
  } catch (err) {
    console.warn('Airport chime audio playback notice:', err);
  }
}

export const ANNOUNCEMENT_START_EVENT = 'dole_announcement_start';
export const ANNOUNCEMENT_END_EVENT = 'dole_announcement_end';

// Keep reference to active SpeechSynthesisUtterance to prevent garbage collection mid-speech
let activeUtterance = null;
let currentChimeTimeout = null;

// Announcement FIFO Queue & Execution State
const announcementQueue = [];
let isAnnouncing = false;
let isAudioDucked = false;

// Set of recently processed call signatures to avoid double-announcing from simultaneous BC + storage events
const recentCallTimestamps = new Map();

/**
 * Cleans up and purges old entries in recentCallTimestamps older than 15 seconds.
 */
function cleanRecentCalls() {
  const now = Date.now();
  for (const [key, ts] of recentCallTimestamps.entries()) {
    if (now - ts > 15000) {
      recentCallTimestamps.delete(key);
    }
  }
}

/**
 * Check if a call signature was recently processed within a short deduplication window.
 */
function isDuplicateCall(queueNo, counter, dedupeWindowMs = 3500) {
  cleanRecentCalls();
  const key = `${String(queueNo || '').trim().toUpperCase()}_${String(counter || '').trim().toUpperCase()}`;
  const now = Date.now();
  const lastTs = recentCallTimestamps.get(key);
  if (lastTs && (now - lastTs) < dedupeWindowMs) {
    return true;
  }
  // Check if this exact queue number and counter is already waiting in line
  const alreadyInQueue = announcementQueue.some(
    item => String(item.queueNo).trim().toUpperCase() === String(queueNo).trim().toUpperCase() &&
            String(item.counter).trim().toUpperCase() === String(counter).trim().toUpperCase()
  );
  if (alreadyInQueue) {
    return true;
  }
  recentCallTimestamps.set(key, now);
  return false;
}

/**
 * Formats utterance text and articulates digits clearly.
 */
export function formatAnnouncementText({ queueNo, counter, personnel, lang = 'en' }) {
  let rawQueue = String(queueNo || '').trim();
  let spokenQueue = rawQueue;
  if (rawQueue.toUpperCase().startsWith('P-')) {
    const numPart = rawQueue.substring(2).split('').join(' ');
    spokenQueue = `Priority P ${numPart}`;
  } else {
    spokenQueue = rawQueue.split('').join(' ');
  }

  const spokenCounter = counter || 'the designated window';
  const cleanPersonnel = (personnel || '').trim();

  if (lang === 'fil') {
    if (cleanPersonnel) {
      return `Kasalukuyang pinaglilingkuran, numero ${spokenQueue}, sa ${spokenCounter}. Mangyaring hanapin si ${cleanPersonnel}.`;
    }
    return `Kasalukuyang pinaglilingkuran, numero ${spokenQueue}, sa ${spokenCounter}.`;
  }

  if (cleanPersonnel) {
    return `Now serving, queue number ${spokenQueue}, at ${spokenCounter}. Please look for ${cleanPersonnel}.`;
  }
  return `Now serving, queue number ${spokenQueue}, at ${spokenCounter}.`;
}

/**
 * Speaks a single queue announcement via Web Speech API and returns a Promise that
 * resolves ONLY when the text-to-speech finishes completely (with watchdog safety).
 */
export function speakQueueAnnouncementAsync({ queueNo, counter, personnel, lang = 'en' }) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve();
      return;
    }

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const text = formatAnnouncementText({ queueNo, counter, personnel, lang });
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.88; // Deliberate, clear PA announcement pace
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.lang = lang === 'fil' ? 'fil-PH' : 'en-US';

      let isFinished = false;
      let watchdogTimer = null;

      const finishSpeech = () => {
        if (isFinished) return;
        isFinished = true;
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        activeUtterance = null;
        resolve();
      };

      utterance.onend = finishSpeech;
      utterance.onerror = (err) => {
        console.debug('SpeechSynthesis error event:', err);
        finishSpeech();
      };

      // Watchdog timer: estimated duration + 4s safety buffer (max 15s)
      const maxDuration = Math.min(15000, Math.max(7000, text.length * 160));
      watchdogTimer = setTimeout(() => {
        console.debug('Speech watchdog timer triggered for queue:', queueNo);
        finishSpeech();
      }, maxDuration);

      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        if (lang === 'fil') {
          const filVoice = voices.find(v => v.lang.startsWith('fil') || v.lang.startsWith('tl'));
          if (filVoice) utterance.voice = filVoice;
        }
        if (!utterance.voice) {
          const preferredVoice =
            voices.find(v => v.lang === 'en-PH') ||
            voices.find(v => (v.lang === 'en-US' || v.lang.startsWith('en')) && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Samantha') || v.name.includes('Zira'))) ||
            voices.find(v => v.lang.startsWith('en')) ||
            voices[0];
          if (preferredVoice) utterance.voice = preferredVoice;
        }
      }

      activeUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.debug('Speech synthesis start exception:', err);
      resolve();
    }
  });
}

/**
 * Backwards-compatible speakQueueAnnouncement callback wrapper.
 */
export function speakQueueAnnouncement({ queueNo, counter, personnel, lang = 'en', onEnd }) {
  speakQueueAnnouncementAsync({ queueNo, counter, personnel, lang }).then(() => {
    onEnd?.();
  });
}

/**
 * Sequential Announcement Worker:
 * Processes one queue announcement at a time in FIFO order:
 * 1. Ducks background media audio.
 * 2. Plays the airport chime (~1.85s).
 * 3. Speaks the full text-to-speech announcement.
 * 4. Ensures queue 001 finishes completely before queue 002 starts!
 * 5. Adds a comfortable 750ms natural pause between successive announcements.
 * 6. Restores background media audio once all announcements finish.
 */
async function processAnnouncementQueue() {
  if (isAnnouncing) {
    // An announcement is already actively playing; next item will run as soon as this one finishes
    return;
  }

  if (announcementQueue.length === 0) {
    // All announcements in the queue have completed
    if (isAudioDucked) {
      isAudioDucked = false;
      try {
        window.dispatchEvent(new CustomEvent(ANNOUNCEMENT_END_EVENT));
      } catch {}
    }
    return;
  }

  isAnnouncing = true;
  const item = announcementQueue.shift();

  try {
    // 1. Duck background audio (only if not already ducked)
    if (!isAudioDucked) {
      isAudioDucked = true;
      try {
        window.dispatchEvent(new CustomEvent(ANNOUNCEMENT_START_EVENT, { detail: item }));
      } catch {}
      item.onDuckStart?.();
    }

    // 2. Play the airport chime and wait for the chimes to ring out cleanly (~1.85s)
    await playAirportChime();
    await new Promise((resolve) => {
      currentChimeTimeout = setTimeout(resolve, 1850);
    });
    currentChimeTimeout = null;

    // 3. Play the speech announcement and await its full completion!
    await speakQueueAnnouncementAsync({
      queueNo: item.queueNo,
      counter: item.counter,
      personnel: item.personnel,
      lang: item.lang,
    });

    item.onDuckEnd?.();

    // 4. If more announcements are waiting in line (e.g. queue 002 after 001),
    //    insert a polite 750ms natural pause before the next chime sounds.
    if (announcementQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } catch (err) {
    console.warn('Announcement execution error:', err);
  } finally {
    isAnnouncing = false;
    // Process next queued announcement
    processAnnouncementQueue();
  }
}

/**
 * Enqueues a call/recall announcement into the FIFO queue.
 * Guarantees that queue numbers never overlap or cut each other off.
 */
export function announceNowServing({ queueNo, counter, personnel, lang = 'en', onDuckStart, onDuckEnd, bypassDedupe = false }) {
  if (!queueNo) return;

  // Deduplicate rapid repeat events within 3.5 seconds
  if (!bypassDedupe && isDuplicateCall(queueNo, counter)) {
    return;
  }

  announcementQueue.push({
    queueNo,
    counter,
    personnel,
    lang,
    onDuckStart,
    onDuckEnd,
  });

  processAnnouncementQueue();
}

/**
 * Clears and cancels all active and pending announcements (e.g., when muting or unmounting).
 */
export function cancelAllAnnouncements() {
  announcementQueue.length = 0;
  if (currentChimeTimeout) {
    clearTimeout(currentChimeTimeout);
    currentChimeTimeout = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
  activeUtterance = null;
  isAnnouncing = false;
  if (isAudioDucked) {
    isAudioDucked = false;
    try {
      window.dispatchEvent(new CustomEvent(ANNOUNCEMENT_END_EVENT));
    } catch {}
  }
}
