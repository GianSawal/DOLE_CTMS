import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { publicApi } from '../../api/public';
import { translations } from '../../locales/translations';
import {
  playAirportChime,
  announceNowServing,
  cancelAllAnnouncements,
  getAudioContext,
  unlockAudioContext,
  isAudioUnlocked,
  CHIME_BROADCAST_CHANNEL,
  ANNOUNCEMENT_START_EVENT,
  ANNOUNCEMENT_END_EVENT,
} from '../../utils/airportChime';
import { parseVideoEmbedUrl } from '../../components/ArtaVideoModal';
import {
  parseFolderLink,
  savePlaylistToIndexedDB,
  loadPlaylistFromIndexedDB,
  clearPlaylistFromIndexedDB,
  pickFolderNative,
} from '../../utils/localVideoPlaylist';

const fallbackServiceDescriptions = {
  sena: 'Conciliation-mediation of labor issues, disputes, and worker grievances.',
  aep: 'Employment permit processing for foreign nationals.',
  tupad: 'Emergency community employment assistance for displaced workers.',
  livelihood: 'Grants and enterprise development support for self-employment.',
  dilp: 'Grants and enterprise development support for self-employment.',
  spes: 'Youth employment assistance during academic breaks.',
  '1020': 'Registration of establishments under OSH standards.',
  cshp: 'Construction safety and health program evaluation & approval.',
  inspection: 'Compliance verification for general labor standards.',
  child: 'Working child permit processing under child labor laws.',
  contractor: 'Contractor & subcontractor registration under D.O. 174.',
};

function getFallbackDesc(serviceName) {
  if (!serviceName) return '';
  const s = serviceName.toLowerCase();
  for (const [key, desc] of Object.entries(fallbackServiceDescriptions)) {
    if (s.includes(key)) return desc;
  }
  return 'Frontline public service, inquiry assistance, and document processing.';
}

const KNOWN_DIVISIONS = [
  { key: 'TSSD 1', alias: 'TSSD1', label: 'TSSD 1', fullName: 'Technical Services & Support Division 1 (Labor Standards / OSH)', color: '#1e40af', accent: '#3b82f6', bgLight: '#dbeafe', bgDark: '#172554' },
  { key: 'TSSD 2', alias: 'TSSD2', label: 'TSSD 2', fullName: 'Technical Services & Support Division 2 (Employment / Welfare)', color: '#047857', accent: '#10b981', bgLight: '#d1fae5', bgDark: '#064e3b' },
  { key: 'IMSD', alias: 'IMSD', label: 'IMSD', fullName: 'Internal Management Services Division (Finance / Admin)', color: '#b45309', accent: '#f59e0b', bgLight: '#fef3c7', bgDark: '#451a03' },
  { key: 'MALSU', alias: 'MALSU', label: 'MALSU', fullName: 'Mediation-Arbitration & Legal Services Unit', color: '#6d28d9', accent: '#8b5cf6', bgLight: '#ede9fe', bgDark: '#3b0764' },
];

const SIMULTANEOUS_PAIRS = [
  {
    value: 'TSSD 1,TSSD 2',
    label: 'Simultaneous (TSSD 1 & TSSD 2 Only)',
    divisions: ['TSSD 1', 'TSSD 2'],
  },
  {
    value: 'IMSD,MALSU',
    label: 'Simultaneous (IMSD & MALSU Only)',
    divisions: ['IMSD', 'MALSU'],
  },
  {
    value: 'IMSD,TSSD 1',
    label: 'Simultaneous (IMSD & TSSD 1 Only)',
    divisions: ['IMSD', 'TSSD 1'],
  },
  {
    value: 'IMSD,TSSD 2',
    label: 'Simultaneous (IMSD & TSSD 2 Only)',
    divisions: ['IMSD', 'TSSD 2'],
  },
  {
    value: 'TSSD 1,MALSU',
    label: 'Simultaneous (TSSD 1 & MALSU Only)',
    divisions: ['TSSD 1', 'MALSU'],
  },
  {
    value: 'TSSD 2,MALSU',
    label: 'Simultaneous (TSSD 2 & MALSU Only)',
    divisions: ['TSSD 2', 'MALSU'],
  },
  {
    value: 'TSSD 1,TSSD 2,IMSD',
    label: 'Simultaneous (TSSD 1, TSSD 2 & IMSD)',
    divisions: ['TSSD 1', 'TSSD 2', 'IMSD'],
  },
  {
    value: 'TSSD 1,TSSD 2,MALSU',
    label: 'Simultaneous (TSSD 1, TSSD 2 & MALSU)',
    divisions: ['TSSD 1', 'TSSD 2', 'MALSU'],
  },
];

function normalizeDiv(name) {
  return (name || '').toUpperCase().replace(/[\s\-_]+/g, '');
}

function matchDivision(divName) {
  if (!divName) return null;
  const norm = normalizeDiv(divName);
  return KNOWN_DIVISIONS.find(d => normalizeDiv(d.key) === norm || normalizeDiv(d.alias) === norm || norm.includes(normalizeDiv(d.alias)));
}

// Dynamically scale down layout and font sizes based on queue volume AND number of simultaneous division columns
function getDynamicScaling(count, numCols = 1) {
  const isCrowded = numCols >= 4; // e.g. 4 or 5 divisions simultaneous

  if (isCrowded) {
    if (count <= 1) {
      return {
        queueFontSize: '2.0rem',
        queueLineHeight: '1',
        rowPadding: '0.6rem 0.75rem',
        cardPadding: '0.7rem 0.75rem',
        counterFontSize: '0.9rem',
        personnelFontSize: '0.86rem',
        serviceFontSize: '0.78rem',
        badgePadding: '0.15rem 0.45rem',
        statusFontSize: '0.7rem',
      };
    } else if (count === 2) {
      return {
        queueFontSize: '1.8rem',
        queueLineHeight: '1',
        rowPadding: '0.5rem 0.65rem',
        cardPadding: '0.6rem 0.65rem',
        counterFontSize: '0.86rem',
        personnelFontSize: '0.82rem',
        serviceFontSize: '0.74rem',
        badgePadding: '0.12rem 0.4rem',
        statusFontSize: '0.68rem',
      };
    } else if (count === 3) {
      return {
        queueFontSize: '1.6rem',
        queueLineHeight: '1.05',
        rowPadding: '0.45rem 0.55rem',
        cardPadding: '0.5rem 0.6rem',
        counterFontSize: '0.82rem',
        personnelFontSize: '0.8rem',
        serviceFontSize: '0.72rem',
        badgePadding: '0.12rem 0.35rem',
        statusFontSize: '0.65rem',
      };
    } else {
      return {
        queueFontSize: '1.45rem',
        queueLineHeight: '1.1',
        rowPadding: '0.35rem 0.45rem',
        cardPadding: '0.4rem 0.5rem',
        counterFontSize: '0.8rem',
        personnelFontSize: '0.76rem',
        serviceFontSize: '0.7rem',
        badgePadding: '0.1rem 0.3rem',
        statusFontSize: '0.62rem',
      };
    }
  }

  if (numCols === 3) {
    if (count <= 1) {
      return {
        queueFontSize: '2.3rem',
        queueLineHeight: '1',
        rowPadding: '0.75rem 0.85rem',
        cardPadding: '0.75rem 0.85rem',
        counterFontSize: '0.98rem',
        personnelFontSize: '0.92rem',
        serviceFontSize: '0.82rem',
        badgePadding: '0.18rem 0.5rem',
        statusFontSize: '0.74rem',
      };
    } else if (count === 2) {
      return {
        queueFontSize: '2.0rem',
        queueLineHeight: '1.05',
        rowPadding: '0.6rem 0.75rem',
        cardPadding: '0.65rem 0.75rem',
        counterFontSize: '0.92rem',
        personnelFontSize: '0.88rem',
        serviceFontSize: '0.78rem',
        badgePadding: '0.15rem 0.45rem',
        statusFontSize: '0.7rem',
      };
    } else {
      return {
        queueFontSize: '1.7rem',
        queueLineHeight: '1.1',
        rowPadding: '0.5rem 0.65rem',
        cardPadding: '0.5rem 0.65rem',
        counterFontSize: '0.86rem',
        personnelFontSize: '0.82rem',
        serviceFontSize: '0.74rem',
        badgePadding: '0.12rem 0.4rem',
        statusFontSize: '0.68rem',
      };
    }
  }

  if (numCols === 2) {
    if (count <= 1) {
      return {
        queueFontSize: '2.6rem',
        queueLineHeight: '1',
        rowPadding: '0.9rem 1rem',
        cardPadding: '0.85rem 1rem',
        counterFontSize: '1.15rem',
        personnelFontSize: '1.02rem',
        serviceFontSize: '0.86rem',
        badgePadding: '0.25rem 0.6rem',
        statusFontSize: '0.78rem',
      };
    } else if (count === 2) {
      return {
        queueFontSize: '2.2rem',
        queueLineHeight: '1.05',
        rowPadding: '0.75rem 0.85rem',
        cardPadding: '0.7rem 0.85rem',
        counterFontSize: '1.05rem',
        personnelFontSize: '0.95rem',
        serviceFontSize: '0.82rem',
        badgePadding: '0.2rem 0.55rem',
        statusFontSize: '0.75rem',
      };
    } else {
      return {
        queueFontSize: '1.85rem',
        queueLineHeight: '1.1',
        rowPadding: '0.55rem 0.7rem',
        cardPadding: '0.55rem 0.7rem',
        counterFontSize: '0.92rem',
        personnelFontSize: '0.88rem',
        serviceFontSize: '0.78rem',
        badgePadding: '0.18rem 0.45rem',
        statusFontSize: '0.72rem',
      };
    }
  }

  // Single Column View (numCols === 1)
  if (count <= 1) {
    return {
      queueFontSize: '3.2rem',
      queueLineHeight: '1',
      rowPadding: '1.25rem 1rem',
      cardPadding: '1.25rem 1rem',
      counterFontSize: '1.35rem',
      personnelFontSize: '1.15rem',
      serviceFontSize: '0.92rem',
      badgePadding: '0.35rem 0.75rem',
      statusFontSize: '0.85rem',
    };
  } else if (count === 2) {
    return {
      queueFontSize: '2.7rem',
      queueLineHeight: '1.05',
      rowPadding: '1rem 0.9rem',
      cardPadding: '1rem 0.9rem',
      counterFontSize: '1.2rem',
      personnelFontSize: '1.05rem',
      serviceFontSize: '0.88rem',
      badgePadding: '0.3rem 0.65rem',
      statusFontSize: '0.82rem',
    };
  } else if (count === 3) {
    return {
      queueFontSize: '2.2rem',
      queueLineHeight: '1.1',
      rowPadding: '0.75rem 0.85rem',
      cardPadding: '0.75rem 0.85rem',
      counterFontSize: '1.05rem',
      personnelFontSize: '0.98rem',
      serviceFontSize: '0.84rem',
      badgePadding: '0.25rem 0.6rem',
      statusFontSize: '0.78rem',
    };
  } else {
    return {
      queueFontSize: '1.75rem',
      queueLineHeight: '1.1',
      rowPadding: '0.55rem 0.7rem',
      cardPadding: '0.55rem 0.7rem',
      counterFontSize: '0.95rem',
      personnelFontSize: '0.9rem',
      serviceFontSize: '0.8rem',
      badgePadding: '0.2rem 0.55rem',
      statusFontSize: '0.75rem',
    };
  }
}

export default function DisplayBoard() {
  const { officeId } = useParams();
  const [lang, setLang] = useState('en');
  const t = translations[lang];
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const [displayData, setDisplayData] = useState(null);
  const { user } = useAuth();
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  // Selected division filter: '' means simultaneous display of all eligible divisions
  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState(() => {
    return localStorage.getItem('ctms_tv_division_filter') || '';
  });

  // Custom division display order for Now Serving drag-and-drop
  const orderStorageKey = officeId ? `ctms_tv_division_order_${officeId}` : 'ctms_tv_division_order';
  const [customDivisionOrder, setCustomDivisionOrder] = useState(() => {
    try {
      const saved = localStorage.getItem(orderStorageKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [draggedDiv, setDraggedDiv] = useState(null);
  const [dragOverDiv, setDragOverDiv] = useState(null);

  // Sync saved division order if officeId changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(orderStorageKey);
      if (saved) {
        setCustomDivisionOrder(JSON.parse(saved));
      }
    } catch {}
  }, [orderStorageKey]);

  // Calculate divisions eligible for this account/screen
  const eligibleDivisions = useMemo(() => {
    // 1. URL search params override (?divisions=TSSD1,TSSD2 or ?division=TSSD1)
    const paramDivs = searchParams.get('divisions') || searchParams.get('division');
    if (paramDivs) {
      const parts = paramDivs.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts;
    }

    const allDivNorms = ['TSSD1', 'TSSD2', 'IMSD', 'MALSU'];

    // 2. Check logged-in user assigned divisions
    const userDivs = (user?.assigned_divisions || user?.division_names || [])
      .map(d => (typeof d === 'string' ? d : d?.name))
      .filter(Boolean);
    const userDivNorms = userDivs.map(d => normalizeDiv(d));
    const userHasAll = user?.is_superuser || (userDivs.length >= 4 && allDivNorms.every(req => userDivNorms.includes(req)));

    // Restrict ONLY if staff user has a restricted subset (e.g. only 1 or 2 divisions, NOT all divisions)
    if (user && !user.is_superuser && userDivs.length > 0 && !userHasAll) {
      return userDivs;
    }

    // 3. Backend response user_divisions (if backend specifically returned a restricted subset)
    if (displayData?.user_divisions && displayData.user_divisions.length > 0) {
      const udNorms = displayData.user_divisions.map(d => normalizeDiv(d));
      const backendHasAll = allDivNorms.every(req => udNorms.includes(req));
      if (!backendHasAll) {
        return displayData.user_divisions;
      }
    }

    // 4. For accounts with access to all divisions (or public TV display of all office divisions):
    // Retrieve all operational divisions from backend response or fallback to KNOWN_DIVISIONS
    let baseDivs = [];
    if (displayData?.all_divisions && displayData.all_divisions.length > 0) {
      baseDivs = displayData.all_divisions.filter(d => d && d.toUpperCase().trim() !== 'ALL');
    }
    if (baseDivs.length === 0) {
      baseDivs = KNOWN_DIVISIONS.map(d => d.key);
    }

    // Also include any active division found in serving or upcoming queue
    const resultDivs = [...baseDivs];
    const existingNorms = new Set(resultDivs.map(d => normalizeDiv(d)));

    (displayData?.serving || []).forEach(s => {
      if (s.division_name && !existingNorms.has(normalizeDiv(s.division_name))) {
        resultDivs.push(s.division_name);
        existingNorms.add(normalizeDiv(s.division_name));
      }
    });
    (displayData?.next_details || []).forEach(n => {
      if (n.division_name && !existingNorms.has(normalizeDiv(n.division_name))) {
        resultDivs.push(n.division_name);
        existingNorms.add(normalizeDiv(n.division_name));
      }
    });

    // Canonical order: TSSD 1, TSSD 2, IMSD, MALSU, followed by any additional custom divisions
    const standardOrder = ['TSSD 1', 'TSSD1', 'TSSD 2', 'TSSD2', 'IMSD', 'MALSU'];
    return resultDivs.sort((a, b) => {
      const normA = normalizeDiv(a);
      const normB = normalizeDiv(b);
      const idxA = standardOrder.findIndex(o => normalizeDiv(o) === normA);
      const idxB = standardOrder.findIndex(o => normalizeDiv(o) === normB);
      const posA = idxA !== -1 ? idxA : 999;
      const posB = idxB !== -1 ? idxB : 999;
      return posA - posB;
    });
  }, [searchParams, user, displayData]);

  // Check if account has access to all divisions (Superuser, unconstrained TV display, or all 4 divisions accessible)
  const hasAccessToAllDivisions = useMemo(() => {
    // 1. Superuser always has full access
    if (user?.is_superuser) return true;

    const allDivNorms = ['TSSD1', 'TSSD2', 'IMSD', 'MALSU'];

    // 2. If URL parameters restrict divisions
    const paramDivs = searchParams.get('divisions') || searchParams.get('division');
    if (paramDivs) {
      const parts = paramDivs.split(',').map(s => s.trim()).filter(Boolean);
      if (!allDivNorms.every(req => parts.some(p => normalizeDiv(p) === req))) {
        return false;
      }
    }

    // 3. If logged in staff user has assigned divisions, verify if they have all 4 divisions
    const userDivs = (user?.assigned_divisions || user?.division_names || [])
      .map(d => (typeof d === 'string' ? d : d?.name))
      .filter(Boolean);
    if (user && !user.is_superuser && userDivs.length > 0) {
      const userDivNorms = userDivs.map(d => normalizeDiv(d));
      return allDivNorms.every(req => userDivNorms.includes(req));
    }

    // 4. Verify all 4 required divisions exist in eligibleDivisions
    const eligibleNorms = eligibleDivisions.map(d => normalizeDiv(d));
    return allDivNorms.every(req => eligibleNorms.includes(req));
  }, [user, searchParams, eligibleDivisions]);

  // Reset division filter if it's a restricted pair but the account no longer has full division access
  useEffect(() => {
    if (selectedDivisionFilter && selectedDivisionFilter.includes(',') && !hasAccessToAllDivisions) {
      setSelectedDivisionFilter('');
      localStorage.removeItem('ctms_tv_division_filter');
    }
  }, [hasAccessToAllDivisions, selectedDivisionFilter]);

  // Active divisions to render simultaneously (validated against eligibleDivisions)
  const activeDivisionsToRender = useMemo(() => {
    let result = eligibleDivisions;

    if (selectedDivisionFilter && selectedDivisionFilter !== 'ALL') {
      // Check if it's comma-separated divisions (e.g. simultaneous pairs)
      if (selectedDivisionFilter.includes(',')) {
        const parts = selectedDivisionFilter.split(',').map(s => s.trim()).filter(Boolean);
        const matched = parts
          .map(part => {
            const targetNorm = normalizeDiv(part);
            return eligibleDivisions.find(ed => {
              if (normalizeDiv(ed) === targetNorm) return true;
              const m1 = matchDivision(ed);
              const m2 = matchDivision(part);
              return m1 && m2 && m1.alias === m2.alias;
            });
          })
          .filter(Boolean);

        if (matched.length === parts.length) {
          result = matched;
        }
      } else {
        // Check if it's a single division
        const validMatch = eligibleDivisions.find(
          d => normalizeDiv(d) === normalizeDiv(selectedDivisionFilter)
        );
        if (validMatch) {
          return [validMatch];
        }
      }
    }

    if (!result || result.length <= 1) {
      return result || [];
    }

    // Apply custom order if present
    if (customDivisionOrder && customDivisionOrder.length > 0) {
      const masterOrder = [...customDivisionOrder];
      // Append any eligible divisions not yet recorded in masterOrder
      eligibleDivisions.forEach(ed => {
        if (!masterOrder.some(m => normalizeDiv(m) === normalizeDiv(ed))) {
          masterOrder.push(ed);
        }
      });

      return [...result].sort((a, b) => {
        const idxA = masterOrder.findIndex(d => {
          if (normalizeDiv(d) === normalizeDiv(a)) return true;
          const ma = matchDivision(a);
          const md = matchDivision(d);
          return ma && md && ma.alias === md.alias;
        });
        const idxB = masterOrder.findIndex(d => {
          if (normalizeDiv(d) === normalizeDiv(b)) return true;
          const mb = matchDivision(b);
          const md = matchDivision(d);
          return mb && md && mb.alias === md.alias;
        });

        const posA = idxA !== -1 ? idxA : 999;
        const posB = idxB !== -1 ? idxB : 999;
        return posA - posB;
      });
    }

    return result;
  }, [eligibleDivisions, selectedDivisionFilter, customDivisionOrder]);

  // Reorder divisions via drag-and-drop
  const handleDropDivision = (sourceDivName, targetDivName) => {
    if (!sourceDivName || !targetDivName || sourceDivName === targetDivName) return;

    setCustomDivisionOrder(prev => {
      const master = [...(prev || [])];
      const allDivs = [...activeDivisionsToRender, ...(eligibleDivisions || [])];
      allDivs.forEach(div => {
        if (!master.some(m => normalizeDiv(m) === normalizeDiv(div))) {
          master.push(div);
        }
      });

      const sourceIdx = master.findIndex(d => {
        if (normalizeDiv(d) === normalizeDiv(sourceDivName)) return true;
        const m1 = matchDivision(d);
        const m2 = matchDivision(sourceDivName);
        return m1 && m2 && m1.alias === m2.alias;
      });
      const targetIdx = master.findIndex(d => {
        if (normalizeDiv(d) === normalizeDiv(targetDivName)) return true;
        const m1 = matchDivision(d);
        const m2 = matchDivision(targetDivName);
        return m1 && m2 && m1.alias === m2.alias;
      });

      if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) {
        return prev;
      }

      const [moved] = master.splice(sourceIdx, 1);
      master.splice(targetIdx, 0, moved);

      try {
        localStorage.setItem(orderStorageKey, JSON.stringify(master));
      } catch (e) {
        console.warn('Failed to save TV division order:', e);
      }

      return master;
    });
  };

  // Helper to check if a division/counter string matches one of activeDivisionsToRender
  const findMatchingActiveDivision = useMemo(() => {
    return (divOrCounterName) => {
      if (!divOrCounterName) return null;
      const direct = activeDivisionsToRender.find(
        targetDiv => normalizeDiv(targetDiv) === normalizeDiv(divOrCounterName)
      );
      if (direct) return direct;
      for (const targetDiv of activeDivisionsToRender) {
        const m1 = matchDivision(targetDiv);
        const m2 = matchDivision(divOrCounterName);
        if (m1 && m2 && m1.alias === m2.alias) {
          return targetDiv;
        }
      }
      return null;
    };
  }, [activeDivisionsToRender]);

  // Group serving items strictly by division (never mix other divisions like TSSD1/TSSD2 into IMSD)
  const servingByDivision = useMemo(() => {
    const groups = {};
    activeDivisionsToRender.forEach(div => {
      groups[div] = [];
    });

    const isRestrictedAccount = Boolean(
      (searchParams.get('divisions') || searchParams.get('division')) ||
      (user && !user.is_superuser && user.assigned_divisions?.length > 0 && !hasAccessToAllDivisions) ||
      (displayData?.user_divisions?.length > 0 && !hasAccessToAllDivisions)
    );

    (displayData?.serving || []).forEach(item => {
      const itemDiv = item.division_name || item.counter || '';
      const matchedDiv = findMatchingActiveDivision(itemDiv);

      if (matchedDiv) {
        groups[matchedDiv].push(item);
      } else if (!isRestrictedAccount && !item.division_name && !matchDivision(item.counter) && activeDivisionsToRender.length > 0) {
        // Only if the item has no division at all AND this display is not restricted to specific divisions
        groups[activeDivisionsToRender[0]].push(item);
      }
    });

    return groups;
  }, [activeDivisionsToRender, displayData?.serving, displayData?.user_divisions, findMatchingActiveDivision, searchParams, user, hasAccessToAllDivisions]);

  // Group upcoming tickets strictly by division
  const nextByDivision = useMemo(() => {
    const groups = {};
    activeDivisionsToRender.forEach(div => {
      groups[div] = [];
    });

    (displayData?.next_details || []).forEach(item => {
      const matchedDiv = findMatchingActiveDivision(item.division_name);
      if (matchedDiv) {
        groups[matchedDiv].push(item.queue_no);
      }
    });

    return groups;
  }, [activeDivisionsToRender, displayData?.next_details, findMatchingActiveDivision]);

  // Right-side "NEXT IN LINE" list filtered strictly to activeDivisionsToRender
  const filteredNextNumbers = useMemo(() => {
    const isRestrictedAccount = Boolean(
      (searchParams.get('divisions') || searchParams.get('division')) ||
      (user && !user.is_superuser && user.assigned_divisions?.length > 0 && !hasAccessToAllDivisions) ||
      (displayData?.user_divisions?.length > 0 && !hasAccessToAllDivisions) ||
      (selectedDivisionFilter && selectedDivisionFilter !== 'ALL')
    );

    if (Array.isArray(displayData?.next_details) && displayData.next_details.length > 0) {
      const hasAnyDivisionTags = displayData.next_details.some(item => Boolean(item.division_name));
      if (isRestrictedAccount || hasAnyDivisionTags) {
        return displayData.next_details
          .filter(item => Boolean(findMatchingActiveDivision(item.division_name)))
          .map(item => item.queue_no)
          .slice(0, 10);
      }
    }

    return isRestrictedAccount ? [] : (displayData?.next || []);
  }, [displayData?.next, displayData?.next_details, displayData?.user_divisions, findMatchingActiveDivision, searchParams, selectedDivisionFilter, user]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('ctms_display_sound_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('ctms_display_theme') || 'dark';
  });

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('ctms_display_theme', nextTheme);
  };

  const DEFAULT_ARTA_VIDEO = '';

  const sanitizeVideoUrl = (url) => {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (
      trimmed.includes('7uK7f0E4g2w') ||
      trimmed.includes('2e6i5GjD4iY') ||
      trimmed.includes('D0EpyUudmkU') ||
      trimmed.includes('mgpg54pyWio')
    ) {
      return '';
    }
    return trimmed;
  };

  const isLight = theme === 'light';
  const [audioUnlocked, setAudioUnlocked] = useState(() => isAudioUnlocked());
  // ARTA video is linked locally by staff on the TV display — not fetched from server
  const [artaVideoUrl, setArtaVideoUrl] = useState('');

  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderInputVal, setFolderInputVal] = useState('');
  const [folderStatusMessage, setFolderStatusMessage] = useState('');
  const [folderStatusType, setFolderStatusType] = useState('info'); // 'info', 'success', 'error'
  const [activeFolderName, setActiveFolderName] = useState(() => {
    return localStorage.getItem(`ctms_tv_folder_name_${officeId}`) || localStorage.getItem('ctms_tv_folder_name') || '';
  });
  const [isLocalPlaylistLoading, setIsLocalPlaylistLoading] = useState(() => {
    try {
      return (
        localStorage.getItem(`ctms_tv_has_local_folder_${officeId}`) === 'true' ||
        localStorage.getItem(`ctms_tv_has_local_video_${officeId}`) === 'true' ||
        localStorage.getItem('ctms_tv_has_local_folder') === 'true' ||
        localStorage.getItem('ctms_tv_has_local_video') === 'true'
      );
    } catch {
      return false;
    }
  });
  const folderFileInputRef = useRef(null);
  const singleFileInputRef = useRef(null);
  const videoRef = useRef(null);
  const isUserPausedRef = useRef(false);
  const isLocalPlaylistActiveRef = useRef(false);
  const iframeRef = useRef(null);
  const defaultVideoVolumeRef = useRef(0.75);
  const isDuckingRef = useRef(false);
  const duckIntervalRef = useRef(null);

  const isFolderLike = (url) => {
    if (!url) return false;
    const t = url.trim();
    return t.includes(',') || t.includes('\n') || t.includes(';') || t.endsWith('/') || !/\.[a-zA-Z0-9]{2,5}($|\?)/.test(t);
  };

  const currentVideoItem = playlist.length > 0 ? (playlist[currentIndex] || playlist[0]) : null;
  const currentVideoUrl = useMemo(() => {
    if (currentVideoItem?.url) {
      return currentVideoItem.url;
    }
    // If local videos are still loading from IndexedDB, do not render a fallback URL yet
    if (isLocalPlaylistLoading) {
      return null;
    }
    // If custom artaVideoUrl is present (e.g. backend uploaded file /media/arta_videos/xxx.mp4 or custom URL)
    if (artaVideoUrl && !isFolderLike(artaVideoUrl)) {
      return sanitizeVideoUrl(artaVideoUrl);
    }
    // Check localStorage cache as fallback
    try {
      const cached = localStorage.getItem(`ctms_arta_video_${officeId}`) || localStorage.getItem('ctms_arta_video');
      if (cached) {
        const parsed = JSON.parse(cached);
        const active = parsed.isActive !== false && parsed.is_active !== false;
        const url = active ? (parsed.videoUrl || parsed.url) : null;
        if (url && !isFolderLike(url)) return sanitizeVideoUrl(url);
      }
    } catch {}

    // Only if local loading is finished and no uploaded or local video exists
    return '';
  }, [currentVideoItem, isLocalPlaylistLoading, artaVideoUrl, officeId]);

  const artaEmbed = useMemo(() => {
    return currentVideoUrl ? parseVideoEmbedUrl(currentVideoUrl) : null;
  }, [currentVideoUrl]);

  const prevServingRef = useRef([]);
  const lastCalledRef = useRef(null);
  const isInitialLoadRef = useRef(true);

  // Audio ducking functions: smoothly tone down video when queue call begins
  const duckAudio = (targetVolume = 0.08, durationMs = 300) => {
    if (!videoRef.current) return;
    isDuckingRef.current = true;
    if (duckIntervalRef.current) clearInterval(duckIntervalRef.current);
    const video = videoRef.current;
    const startVol = video.volume;
    const steps = 10;
    const stepTime = durationMs / steps;
    const volStep = (startVol - targetVolume) / steps;
    let step = 0;

    duckIntervalRef.current = setInterval(() => {
      step++;
      const newVol = Math.max(0, startVol - volStep * step);
      if (video) video.volume = Math.max(0, Math.min(1, newVol));
      if (step >= steps) {
        clearInterval(duckIntervalRef.current);
        if (video) video.volume = targetVolume;
      }
    }, stepTime);
  };

  // Restore video volume when announcement finishes
  const restoreAudio = (targetVolume = defaultVideoVolumeRef.current, durationMs = 500) => {
    if (!videoRef.current) return;
    if (duckIntervalRef.current) clearInterval(duckIntervalRef.current);
    const video = videoRef.current;
    const startVol = video.volume;
    const steps = 10;
    const stepTime = durationMs / steps;
    const volStep = (targetVolume - startVol) / steps;
    let step = 0;

    duckIntervalRef.current = setInterval(() => {
      step++;
      const newVol = Math.min(1, startVol + volStep * step);
      if (video) video.volume = Math.max(0, Math.min(1, newVol));
      if (step >= steps) {
        clearInterval(duckIntervalRef.current);
        if (video) video.volume = targetVolume;
        isDuckingRef.current = false;
      }
    }, stepTime);
  };

  const handleDuckStart = () => {
    duckAudio(0.08, 250);
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [10] }),
          '*'
        );
      } catch {}
    }
  };

  const handleDuckEnd = () => {
    restoreAudio(defaultVideoVolumeRef.current, 400);
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [80] }),
          '*'
        );
      } catch {}
    }
  };

  // Global listener for first user interaction (touch, click, key) to unlock Web Audio API & TTS
  useEffect(() => {
    const handleUnlock = (e) => {
      const isVideoTarget = e?.target?.closest?.('video') || e?.target?.tagName === 'VIDEO';

      unlockAudioContext().then(unlocked => {
        if (unlocked) {
          setAudioUnlocked(true);
          if (videoRef.current) {
            videoRef.current.muted = false;
            videoRef.current.volume = isDuckingRef.current ? 0.08 : defaultVideoVolumeRef.current;
            if (!isUserPausedRef.current && !isVideoTarget && videoRef.current.paused) {
              videoRef.current.play().catch(() => {});
            }
          }
        }
      });
    };

    window.addEventListener('click', handleUnlock);
    window.addEventListener('touchstart', handleUnlock);
    window.addEventListener('keydown', handleUnlock);

    return () => {
      window.removeEventListener('click', handleUnlock);
      window.removeEventListener('touchstart', handleUnlock);
      window.removeEventListener('keydown', handleUnlock);
    };
  }, []);

  // Listen for announcement lifecycle events for audio ducking
  useEffect(() => {
    window.addEventListener(ANNOUNCEMENT_START_EVENT, handleDuckStart);
    window.addEventListener(ANNOUNCEMENT_END_EVENT, handleDuckEnd);

    return () => {
      window.removeEventListener(ANNOUNCEMENT_START_EVENT, handleDuckStart);
      window.removeEventListener(ANNOUNCEMENT_END_EVENT, handleDuckEnd);
      if (duckIntervalRef.current) clearInterval(duckIntervalRef.current);
    };
  }, []);

  // Ensure webkitdirectory property is set on the DOM node for full browser compatibility
  useEffect(() => {
    if (folderFileInputRef.current) {
      folderFileInputRef.current.setAttribute('webkitdirectory', '');
      folderFileInputRef.current.setAttribute('directory', '');
      folderFileInputRef.current.webkitdirectory = true;
    }
  }, []);

  // Auto-play trigger whenever direct video src changes
  useEffect(() => {
    if (videoRef.current && artaEmbed && artaEmbed.type === 'direct') {
      const v = videoRef.current;
      v.volume = isDuckingRef.current ? 0.08 : defaultVideoVolumeRef.current;
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          if (!isUserPausedRef.current) {
            v.muted = true;
            v.play().catch(() => {});
          }
        });
      }
    }
  }, [artaEmbed?.url]);

  // Load playlist: 1. IndexedDB local folder videos, 2. localStorage folder link, 3. backend artaVideoUrl
  useEffect(() => {
    let isMounted = true;
    async function initPlaylist() {
      // 1. Check local IndexedDB folder videos
      try {
        const dbItems = await loadPlaylistFromIndexedDB();
        if (isMounted && dbItems && dbItems.length > 0) {
          isLocalPlaylistActiveRef.current = true;
          setPlaylist(dbItems);
          setCurrentIndex(0);
          setIsLocalPlaylistLoading(false);
          return;
        }
      } catch (err) {
        console.warn('Error reading stored video playlist:', err);
      }

      if (isMounted) {
        setIsLocalPlaylistLoading(false);
      }

      // If active in-memory local folder playlist is already loaded, don't overwrite with backend polling
      if (isLocalPlaylistActiveRef.current) return;

      // 2. Check locally saved folder link on this TV display
      let savedTvLink = localStorage.getItem(`ctms_tv_folder_link_${officeId}`) || localStorage.getItem('ctms_tv_folder_link');
      if (savedTvLink && (savedTvLink.includes('7uK7f0E4g2w') || savedTvLink.includes('2e6i5GjD4iY') || savedTvLink.includes('D0EpyUudmkU'))) {
        localStorage.removeItem(`ctms_tv_folder_link_${officeId}`);
        localStorage.removeItem('ctms_tv_folder_link');
        savedTvLink = null;
      }

      // 3. Use only locally saved folder link (no server video fallback)
      const candidateUrl = savedTvLink || '';

      const targetUrl = candidateUrl ? sanitizeVideoUrl(candidateUrl) : '';
      if (!targetUrl) {
        if (isMounted) {
          setPlaylist([]);
          setCurrentIndex(0);
        }
        return;
      }

      const ytEmbed = parseVideoEmbedUrl(targetUrl);
      if (ytEmbed && ytEmbed.type === 'youtube') {
        if (isMounted) {
          setPlaylist([{ id: 0, url: ytEmbed.url, name: "ARTA Citizen's Charter", isYouTube: true }]);
          setCurrentIndex(0);
        }
        return;
      }

      if (isFolderLike(targetUrl)) {
        const items = await parseFolderLink(targetUrl);
        if (isMounted) {
          if (items && items.length > 0) {
            setPlaylist(items);
            setCurrentIndex(0);
            return;
          }
        }
      }

      if (isMounted) {
        const fileName = targetUrl.split('/').pop().split('?')[0] || "ARTA Awareness Video";
        setPlaylist([{ id: 0, url: targetUrl, name: fileName, isYouTube: false }]);
        setCurrentIndex(0);
      }
    }

    initPlaylist();
    return () => { isMounted = false; };
  }, [officeId, artaVideoUrl]);

  // Process selected folder files (auto-plays immediately and saves to IndexedDB)
  const processSelectedFolderFiles = async (files, folderName = '', dirHandle = null) => {
    if (!files || !files.length) return;

    setFolderStatusMessage('Scanning video files...');
    setFolderStatusType('info');

    try {
      const saved = await savePlaylistToIndexedDB(files, folderName, dirHandle);
      if (saved && saved.length > 0) {
        isUserPausedRef.current = false;
        isLocalPlaylistActiveRef.current = true;
        setPlaylist(saved);
        setCurrentIndex(0);
        setActiveFolderName(folderName || 'Selected Videos');
        localStorage.setItem(`ctms_tv_has_local_folder_${officeId}`, 'true');
        localStorage.setItem(`ctms_tv_has_local_video_${officeId}`, 'true');
        localStorage.setItem('ctms_tv_has_local_folder', 'true');
        localStorage.setItem('ctms_tv_has_local_video', 'true');
        if (folderName) {
          localStorage.setItem(`ctms_tv_folder_name_${officeId}`, folderName);
          localStorage.setItem('ctms_tv_folder_name', folderName);
        }
        localStorage.removeItem(`ctms_tv_folder_link_${officeId}`);
        localStorage.removeItem('ctms_tv_folder_link');
        setIsLocalPlaylistLoading(false);

        // Auto-close modal immediately
        setShowFolderModal(false);
        setFolderStatusMessage('');

        // Trigger instant playback
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.currentTime = 0;
            const p = videoRef.current.play();
            if (p !== undefined) {
              p.catch(() => {
                if (videoRef.current) {
                  videoRef.current.muted = true;
                  videoRef.current.play().catch(() => {});
                }
              });
            }
          }
        }, 100);

      } else {
        setFolderStatusMessage('No supported video files (.mp4, .webm, .mkv, .avi, .mov, etc.) found in the selection.');
        setFolderStatusType('error');
      }
    } catch (err) {
      console.error('Failed to process local video files:', err);
      setFolderStatusMessage('Error loading files. Please try selecting the files or folder again.');
      setFolderStatusType('error');
    }
  };

  const handleSelectFileClick = () => {
    if (singleFileInputRef.current) {
      singleFileInputRef.current.click();
    }
  };

  const handleSingleFilesSelected = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) {
      if (e.target) e.target.value = '';
      return;
    }
    const label = files.length === 1 ? files[0].name : `${files.length} Videos`;
    await processSelectedFolderFiles(files, label);
    if (e.target) e.target.value = '';
  };

  // Open native folder picker or fallback to webkitdirectory input
  const handleSelectFolderClick = async () => {
    // 1. Try modern File System Access API (showDirectoryPicker)
    // Opens the actual Windows "Select Folder" dialog directly!
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        setFolderStatusMessage('Opening folder picker...');
        setFolderStatusType('info');
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        if (dirHandle) {
          const fileList = [];
          for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
              try {
                const f = await entry.getFile();
                fileList.push(f);
              } catch (e) {
                console.warn('Could not read file:', entry.name, e);
              }
            }
          }
          await processSelectedFolderFiles(fileList, dirHandle.name, dirHandle);
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          setFolderStatusMessage('');
          return;
        }
        console.warn('Native folder picker fallback:', err);
      }
    }

    // 2. Fallback to input with webkitdirectory
    if (folderFileInputRef.current) {
      folderFileInputRef.current.click();
    }
  };

  // Handle files selected via file input
  const handleFolderFilesSelected = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) {
      if (e.target) e.target.value = '';
      return;
    }
    const detectedFolderName = files[0]?.webkitRelativePath
      ? files[0].webkitRelativePath.split('/')[0]
      : '';
    await processSelectedFolderFiles(files, detectedFolderName);
    if (e.target) e.target.value = '';
  };

  // Handle saving custom folder link or multiple URLs
  const handleSaveCustomFolderLink = async (e) => {
    e?.preventDefault?.();
    const trimmed = folderInputVal.trim();
    if (!trimmed) return;

    const isLocalDrivePath = /^[a-zA-Z]:[\\\/]/.test(trimmed) || trimmed.startsWith('file://');

    setFolderStatusMessage('Connecting to folder...');
    setFolderStatusType('info');

    try {
      const ytEmbed = parseVideoEmbedUrl(trimmed);
      if (ytEmbed && ytEmbed.type === 'youtube') {
        localStorage.setItem(`ctms_tv_folder_link_${officeId}`, trimmed);
        await clearPlaylistFromIndexedDB();
        isLocalPlaylistActiveRef.current = false;
        isUserPausedRef.current = false;
        setPlaylist([{ id: 0, url: ytEmbed.url, name: "ARTA Video", isYouTube: true }]);
        setCurrentIndex(0);
        setShowFolderModal(false);
        setFolderStatusMessage('');
        return;
      }

      const items = await parseFolderLink(trimmed);
      if (items && items.length > 0) {
        localStorage.setItem(`ctms_tv_folder_link_${officeId}`, trimmed);
        await clearPlaylistFromIndexedDB();
        isLocalPlaylistActiveRef.current = true;
        isUserPausedRef.current = false;
        setPlaylist(items);
        setCurrentIndex(0);
        setShowFolderModal(false);
        setFolderStatusMessage('');
      } else if (isLocalDrivePath) {
        setFolderStatusMessage('Local computer drive paths (e.g. C:\\...) cannot be opened directly by browser security. Please click "Choose Video Folder..." above to choose your folder directly.');
        setFolderStatusType('error');
      } else {
        localStorage.setItem(`ctms_tv_folder_link_${officeId}`, trimmed);
        await clearPlaylistFromIndexedDB();
        isLocalPlaylistActiveRef.current = false;
        isUserPausedRef.current = false;
        setPlaylist([{ id: 0, url: trimmed, isYouTube: false }]);
        setCurrentIndex(0);
        setShowFolderModal(false);
        setFolderStatusMessage('');
      }
    } catch (err) {
      console.error('Failed to parse folder link:', err);
      setFolderStatusMessage('Failed to connect to folder link.');
      setFolderStatusType('error');
    }
  };

  // Reset to default ARTA YouTube video
  const handleResetToDefaultVideo = async () => {
    isLocalPlaylistActiveRef.current = false;
    localStorage.removeItem(`ctms_tv_has_local_folder_${officeId}`);
    localStorage.removeItem(`ctms_tv_has_local_video_${officeId}`);
    localStorage.removeItem('ctms_tv_has_local_folder');
    localStorage.removeItem('ctms_tv_has_local_video');
    localStorage.removeItem(`ctms_tv_folder_name_${officeId}`);
    localStorage.removeItem('ctms_tv_folder_name');
    localStorage.removeItem(`ctms_tv_folder_link_${officeId}`);
    localStorage.removeItem('ctms_tv_folder_link');
    localStorage.removeItem(`ctms_arta_video_${officeId}`);
    localStorage.removeItem('ctms_arta_video');
    await clearPlaylistFromIndexedDB();
    setActiveFolderName('');
    setArtaVideoUrl('');
    setPlaylist([]);
    setCurrentIndex(0);
    setShowFolderModal(false);
    setFolderStatusMessage('');
  };

  // Auto-advance to next video in folder when current video finishes
  const handleVideoEnded = () => {
    if (playlist && playlist.length > 1) {
      isUserPausedRef.current = false;
      setCurrentIndex((prev) => (prev + 1) % playlist.length);
    }
  };

  const handleVideoCanPlay = (e) => {
    const video = e.target;
    if (isUserPausedRef.current) return;
    video.volume = isDuckingRef.current ? 0.08 : defaultVideoVolumeRef.current;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        if (!isUserPausedRef.current) {
          video.muted = true;
          video.play().catch(() => {});
        }
      });
    }
  };

  const handleToggleSound = async () => {
    const nextState = !soundEnabled;
    setSoundEnabled(nextState);
    localStorage.setItem('ctms_display_sound_enabled', String(nextState));
    if (nextState) {
      await unlockAudioContext();
      setAudioUnlocked(true);
      const firstServing = displayData?.serving?.[0];
      announceNowServing({
        queueNo: firstServing?.queue_no || displayData?.next?.[0] || '042',
        counter: firstServing?.counter || 'Window 1',
        personnel: firstServing?.assigned_personnel || '',
        lang: langRef.current,
        bypassDedupe: true,
      });
    } else {
      cancelAllAnnouncements();
    }
  };

  const findMatchingActiveDivisionRef = useRef(findMatchingActiveDivision);
  useEffect(() => {
    findMatchingActiveDivisionRef.current = findMatchingActiveDivision;
  }, [findMatchingActiveDivision]);

  const divisionsQueryParam = useMemo(() => {
    const fromUrl = searchParams.get('divisions') || searchParams.get('division');
    if (fromUrl) return fromUrl;
    const userDivs = (user?.assigned_divisions || user?.division_names || [])
      .map(d => (typeof d === 'string' ? d : d?.name))
      .filter(Boolean);
    const allDivNorms = ['TSSD1', 'TSSD2', 'IMSD', 'MALSU'];
    const userDivNorms = userDivs.map(d => normalizeDiv(d));
    const userHasAll = user?.is_superuser || (userDivs.length >= 4 && allDivNorms.every(req => userDivNorms.includes(req)));
    if (user && !user.is_superuser && userDivs.length > 0 && !userHasAll) {
      return userDivs.join(',');
    }
    return '';
  }, [searchParams, user]);

  const processedCallIdsRef = useRef(new Set());

  useEffect(() => {
    let isMounted = true;

    async function fetchDisplay() {
      try {
        const data = await publicApi.getDisplayBoard(officeId, divisionsQueryParam);
        if (!isMounted) return;

        const currentLatestCall = data.latest_called_at || (data.serving?.[0]?.called_at) || null;

        if (isInitialLoadRef.current) {
          // Record baseline timestamp on initial mount without chiming
          lastCalledRef.current = currentLatestCall;
          prevServingRef.current = data.serving || [];
          isInitialLoadRef.current = false;
        } else {
          // Detect call, recall, or call-next:
          // 1. latest_called_at changed (new timestamp from call, recall, or call next)
          const callTimestampChanged = Boolean(
            currentLatestCall &&
            currentLatestCall !== lastCalledRef.current
          );

          // 2. New queue number appeared in serving (e.g. from empty queue or status change)
          const prevNumbers = (prevServingRef.current || []).map(s => s.queue_no);
          const hasNewQueueNumber = data.serving?.some(s => !prevNumbers.includes(s.queue_no));

          if (callTimestampChanged || hasNewQueueNumber) {
            lastCalledRef.current = currentLatestCall;
            if (soundEnabled) {
              const qNo = data.latest_called_queue_no || data.serving?.[0]?.queue_no;
              const cnt = data.latest_called_counter || data.serving?.[0]?.counter;
              const psn = data.latest_called_personnel || data.serving?.[0]?.assigned_personnel;
              announceNowServing({
                queueNo: qNo,
                counter: cnt,
                personnel: psn,
                lang: langRef.current,
              });
            }
          }
          prevServingRef.current = data.serving || [];
        }

        // ARTA video is linked locally — do not use server arta_video_url
        setDisplayData(data);
        setError('');
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Error fetching display data.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchDisplay();
    // Fast polling: 2500ms
    const interval = setInterval(fetchDisplay, 2500);

    // Cross-tab broadcast listener for instant 0ms chime and voice announcement
    let bc = null;
    let videoBc = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(CHIME_BROADCAST_CHANNEL);
        bc.onmessage = (event) => {
          if (!isMounted) return;
          if (event.data?.type === 'QUEUE_CALLED') {
            if (event.data?.callId) {
              processedCallIdsRef.current.add(event.data.callId);
            }
            if (!event.data.officeId || String(event.data.officeId) === String(officeId)) {
              const calledCounter = event.data.counter || '';
              const isOtherDivision = matchDivision(calledCounter) && !findMatchingActiveDivisionRef.current?.(calledCounter);
              if (!isOtherDivision && soundEnabled) {
                announceNowServing({
                  queueNo: event.data.queueNo,
                  counter: event.data.counter,
                  personnel: event.data.personnel,
                  lang: langRef.current,
                });
              }
              // Immediately fetch updated display data
              fetchDisplay();
            }
          }
        };

        videoBc = new BroadcastChannel('ctms_arta_video_channel');
        videoBc.onmessage = (event) => {
          if (!isMounted) return;
          if (event.data?.type === 'ARTA_VIDEO_UPDATED') {
            // ARTA video is linked locally — ignore server video updates
            fetchDisplay();
          }
        };
      }
    } catch {}

    // Storage fallback for cross-tab sync
    const handleStorage = (e) => {
      if (!isMounted) return;
      if (e.key === 'dole_last_queue_call' && e.newValue) {
        try {
          const item = JSON.parse(e.newValue);
          if (item.callId && processedCallIdsRef.current.has(item.callId)) {
            return;
          }
          if (item.callId) {
            processedCallIdsRef.current.add(item.callId);
          }
          if (!item.officeId || String(item.officeId) === String(officeId)) {
            const calledCounter = item.counter || '';
            const isOtherDivision = matchDivision(calledCounter) && !findMatchingActiveDivisionRef.current?.(calledCounter);
            if (!isOtherDivision && soundEnabled) {
              announceNowServing({
                queueNo: item.queueNo,
                counter: item.counter,
                personnel: item.personnel,
                lang: langRef.current,
              });
            }
            fetchDisplay();
          }
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      isMounted = false;
      clearInterval(interval);
      cancelAllAnnouncements();
      if (bc) {
        try { bc.close(); } catch {}
      }
      if (videoBc) {
        try { videoBc.close(); } catch {}
      }
      window.removeEventListener('storage', handleStorage);
    };
  }, [officeId, soundEnabled, divisionsQueryParam]);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: isLight ? '#e5e9f0' : '#0f172a', color: isLight ? '#0f172a' : '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2rem' }}>Loading Display Board...</h1>
      </div>
    );
  }

  const themeStyles = {
    pageBg: isLight ? '#e5e9f0' : '#0a0f1d',
    pageColor: isLight ? '#0f172a' : '#ffffff',
    headerBorder: isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.1)',
    subTitleColor: isLight ? '#9a3412' : 'var(--dole-gold)',
    titleColor: isLight ? '#0f172a' : '#ffffff',
    sectionTitleColor: isLight ? '#1e3a8a' : 'var(--dole-gold)',
    cardBg: isLight ? '#f8fafc' : '#161e31',
    cardBorder: isLight ? '2px solid #3b82f6' : '2px solid rgba(3, 5, 186, 0.6)',
    cardShadow: isLight ? '0 4px 16px rgba(0, 0, 0, 0.06)' : '0 8px 24px rgba(0, 0, 0, 0.5)',
    counterLabel: isLight ? '#475569' : '#94a3b8',
    queueNoColor: isLight ? '#1e3a8a' : 'var(--dole-gold)',
    queueNoShadow: 'none',
    personnelBadgeBg: isLight ? 'rgba(217, 119, 6, 0.12)' : 'rgba(217, 119, 6, 0.22)',
    personnelBadgeBorder: isLight ? '2px solid rgba(217, 119, 6, 0.6)' : '2px solid rgba(255, 198, 3, 0.75)',
    personnelText: isLight ? '#92400e' : '#fef08a',
    personnelName: isLight ? '#1e3a8a' : '#ffffff',
    serviceBoxBg: isLight ? 'rgba(30, 58, 138, 0.05)' : 'rgba(255, 255, 255, 0.04)',
    serviceBoxBorder: isLight ? '1px solid rgba(30, 58, 138, 0.15)' : '1px solid rgba(255, 255, 255, 0.08)',
    serviceNameColor: isLight ? '#0f172a' : '#f8fafc',
    serviceDescColor: isLight ? '#475569' : '#94a3b8',
    emptyServingBg: isLight ? '#edf2f7' : '#161e31',
    emptyServingBorder: isLight ? '1px dashed rgba(0, 0, 0, 0.15)' : '1px dashed rgba(255, 255, 255, 0.15)',
    emptyServingColor: isLight ? '#64748b' : '#64748b',
    rightSectionBg: isLight ? '#f8fafc' : '#111827',
    rightSectionBorder: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.1)',
    rightSectionShadow: isLight ? '0 4px 16px rgba(0, 0, 0, 0.05)' : 'none',
    nextTitleColor: isLight ? '#1e3a8a' : '#93c5fd',
    nextTitleBorder: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.1)',
    nextItemBg: isLight ? '#edf2f7' : '#1e293b',
    nextItemNumber: isLight ? '#0f172a' : '#ffffff',
    nextItemBorder: isLight ? '1px solid #cbd5e1' : 'none',
    footerBorder: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.1)',
    footerColor: '#64748b',
    btnColor: isLight ? '#1e293b' : '#ffffff',
    btnBorder: isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.2)',
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: themeStyles.pageBg,
      color: themeStyles.pageColor,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-ui)',
      padding: '1.5rem 2rem',
      transition: 'background-color 0.2s ease, color 0.2s ease',
    }}>
      {/* Autoplay Audio Unlock Notice */}
      {soundEnabled && !audioUnlocked && (
        <div
          onClick={async () => {
            await unlockAudioContext();
            setAudioUnlocked(true);
            const firstServing = displayData?.serving?.[0];
            announceNowServing({
              queueNo: firstServing?.queue_no || displayData?.next?.[0] || '042',
              counter: firstServing?.counter || 'Window 1',
              personnel: firstServing?.assigned_personnel || 'Officer on Duty',
              lang: langRef.current,
              bypassDedupe: true,
            });
          }}
          style={{
            backgroundColor: isLight ? '#fef3c7' : 'rgba(217, 119, 6, 0.95)',
            color: isLight ? '#92400e' : '#ffffff',
            padding: '0.65rem 1.5rem',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            boxShadow: isLight ? '0 2px 8px rgba(0, 0, 0, 0.06)' : '0 4px 15px rgba(217, 119, 6, 0.35)',
            border: isLight ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <span style={{ fontSize: '1.25rem' }}>🔔</span>
            <span>Airport Chime & Voice Announcer is ON: Tap or click anywhere on this screen to activate audio playback for this display.</span>
          </div>
          <button
            className="btn btn-sm"
            style={{ backgroundColor: isLight ? '#f59e0b' : '#ffffff', color: isLight ? '#ffffff' : '#b45309', fontWeight: 800, border: 'none', minWidth: '120px' }}
          >
            Activate Sound
          </button>
        </div>
      )}

      {/* Top Banner */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `2px solid ${themeStyles.headerBorder}`,
        paddingBottom: '1.25rem',
        marginBottom: '2rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <img
            src="/dolelogo.png"
            alt="DOLE Official Seal"
            style={{ width: '76px', height: '76px', objectFit: 'contain', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.3))' }}
          />
          <div>
            <div style={{
              fontSize: '1rem',
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: themeStyles.subTitleColor,
            }}>
              Republic of the Philippines · DOLE
            </div>
            <h1 style={{ fontSize: '2.25rem', fontWeight: 900, margin: 0, letterSpacing: '-0.02em', color: themeStyles.titleColor }}>
              {displayData?.office?.name}
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Light / Dark Mode Toggle Button */}
          <button
            onClick={toggleTheme}
            className="btn btn-outline btn-sm"
            style={{
              color: themeStyles.btnColor,
              borderColor: themeStyles.btnBorder,
              backgroundColor: isLight ? '#ffffff' : 'rgba(255, 255, 255, 0.08)',
              boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
            title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            <span>{isLight ? '🌙' : '☀️'}</span>
            <span>{isLight ? 'Dark Mode' : 'Light Mode'}</span>
          </button>

          <button
            onClick={handleToggleSound}
            className="btn btn-outline btn-sm"
            style={{
              color: soundEnabled ? (isLight ? '#92400e' : '#ffffff') : themeStyles.btnColor,
              borderColor: soundEnabled ? (isLight ? '#d97706' : 'var(--dole-gold)') : themeStyles.btnBorder,
              backgroundColor: soundEnabled ? (isLight ? '#fef3c7' : 'rgba(217, 119, 6, 0.25)') : (isLight ? '#ffffff' : 'transparent'),
              boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
              fontWeight: 600,
            }}
            title={soundEnabled ? 'Click to mute airport chime & voice' : 'Click to enable airport announcement chime & voice'}
          >
            {soundEnabled ? '🔔 Chime & Voice ON' : '🔕 Sound OFF'}
          </button>
          {soundEnabled && (
            <button
              onClick={async () => {
                await unlockAudioContext();
                setAudioUnlocked(true);
                const firstServing = displayData?.serving?.[0];
                announceNowServing({
                  queueNo: firstServing?.queue_no || displayData?.next?.[0] || '042',
                  counter: firstServing?.counter || 'Window 1',
                  personnel: firstServing?.assigned_personnel || 'Officer on Duty',
                  lang: langRef.current,
                  bypassDedupe: true,
                });
              }}
              className="btn btn-outline btn-sm"
              style={{
                color: isLight ? '#92400e' : 'var(--dole-gold)',
                borderColor: isLight ? '#d97706' : 'rgba(217, 119, 6, 0.5)',
                backgroundColor: isLight ? '#fef3c7' : 'rgba(0, 0, 0, 0.3)',
                boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
                padding: '0.25rem 0.6rem',
                fontSize: '0.75rem',
              }}
              title="Test airport chime and voice announcement on speakers"
            >
              ▶ Test Chime & Voice
            </button>
          )}
          <button
            onClick={() => setLang(lang === 'en' ? 'fil' : 'en')}
            className="btn btn-outline btn-sm"
            style={{
              color: themeStyles.btnColor,
              borderColor: themeStyles.btnBorder,
              backgroundColor: isLight ? '#ffffff' : 'transparent',
              boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
            }}
          >
            🌐 {lang === 'en' ? 'Filipino' : 'English'}
          </button>
          {eligibleDivisions.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <select
                value={selectedDivisionFilter}
                onChange={(e) => {
                  setSelectedDivisionFilter(e.target.value);
                  localStorage.setItem('ctms_tv_division_filter', e.target.value);
                }}
                className={`staff-custom-select ${isLight ? 'tv-select-light' : 'tv-select-dark'}`}
                style={{
                  padding: '0.25rem 1.8rem 0.25rem 0.65rem',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255,255,255,0.25)',
                  backgroundColor: isLight ? '#ffffff' : '#0f172a',
                  color: isLight ? '#0f172a' : '#ffffff',
                  colorScheme: isLight ? 'light' : 'dark',
                  boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
                  minHeight: '32px',
                  cursor: 'pointer',
                }}
                title="Select division display mode"
              >
                <option
                  value=""
                  style={{
                    backgroundColor: isLight ? '#ffffff' : '#0f172a',
                    color: isLight ? '#0f172a' : '#ffffff',
                  }}
                >
                  {eligibleDivisions.length >= 4
                    ? 'Simultaneous (All Divisions: TSSD 1, TSSD 2, IMSD & MALSU)'
                    : `Simultaneous (${eligibleDivisions.map(d => matchDivision(d)?.alias || d).join(' & ')})`}
                </option>
                {hasAccessToAllDivisions && SIMULTANEOUS_PAIRS.filter(pair =>
                  pair.divisions.every(pDiv => eligibleDivisions.some(ed => normalizeDiv(ed) === normalizeDiv(pDiv)))
                ).map(pair => (
                  <option
                    key={pair.value}
                    value={pair.value}
                    style={{
                      backgroundColor: isLight ? '#ffffff' : '#0f172a',
                      color: isLight ? '#0f172a' : '#ffffff',
                    }}
                  >
                    {pair.label}
                  </option>
                ))}
                {eligibleDivisions.map(d => (
                  <option
                    key={d}
                    value={d}
                    style={{
                      backgroundColor: isLight ? '#ffffff' : '#0f172a',
                      color: isLight ? '#0f172a' : '#ffffff',
                    }}
                  >
                    Show {matchDivision(d)?.label || d} Only
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={toggleFullScreen}
            className="btn btn-outline btn-sm"
            style={{
              color: themeStyles.btnColor,
              borderColor: themeStyles.btnBorder,
              backgroundColor: isLight ? '#ffffff' : 'transparent',
              boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
            }}
          >
            ⛶ Fullscreen
          </button>
        </div>
      </header>

      {/* Main Grid: Serving Counters & Next Queue */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: activeDivisionsToRender.length >= 4 ? '2.5fr 1fr' : '2.2fr 1fr',
        gap: activeDivisionsToRender.length >= 4 ? '1.25rem' : '2rem',
      }}>
        {/* Left Side: NOW SERVING */}
        <section style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: themeStyles.sectionTitleColor,
            marginBottom: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#10b981', animation: 'pulse 1.5s infinite' }} />
            {t.display_title}
          </div>

          <div style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: activeDivisionsToRender.length > 1
              ? `repeat(${activeDivisionsToRender.length}, minmax(0, 1fr))`
              : '1fr',
            gap: activeDivisionsToRender.length >= 4 ? '0.65rem' : (activeDivisionsToRender.length > 1 ? '0.85rem' : '1.25rem'),
            minHeight: 0,
          }}>
            {activeDivisionsToRender.map((divName) => {
              const divMeta = matchDivision(divName);
              const divItems = servingByDivision[divName] || [];
              const divUpcoming = nextByDivision[divName] || [];
              const isSimultaneous = activeDivisionsToRender.length > 1;
              const isCrowded = activeDivisionsToRender.length >= 4;
              const scale = getDynamicScaling(divItems.length, activeDivisionsToRender.length);

              const isDraggable = activeDivisionsToRender.length > 1;
              const isBeingDragged = draggedDiv === divName;
              const isDropTarget = dragOverDiv === divName && draggedDiv !== divName;

              return (
                <div
                  key={divName}
                  draggable={isDraggable}
                  onDragStart={(e) => {
                    if (!isDraggable) return;
                    e.dataTransfer.setData('text/plain', divName);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedDiv(divName);
                  }}
                  onDragOver={(e) => {
                    if (!isDraggable) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (draggedDiv && draggedDiv !== divName && dragOverDiv !== divName) {
                      setDragOverDiv(divName);
                    }
                  }}
                  onDragEnter={(e) => {
                    if (!isDraggable) return;
                    e.preventDefault();
                    if (draggedDiv && draggedDiv !== divName) {
                      setDragOverDiv(divName);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!isDraggable) return;
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      if (dragOverDiv === divName) {
                        setDragOverDiv(null);
                      }
                    }
                  }}
                  onDrop={(e) => {
                    if (!isDraggable) return;
                    e.preventDefault();
                    const source = e.dataTransfer.getData('text/plain') || draggedDiv;
                    if (source && source !== divName) {
                      handleDropDivision(source, divName);
                    }
                    setDraggedDiv(null);
                    setDragOverDiv(null);
                  }}
                  onDragEnd={() => {
                    setDraggedDiv(null);
                    setDragOverDiv(null);
                  }}
                  style={{
                    backgroundColor: themeStyles.cardBg,
                    borderRadius: '16px',
                    border: isDropTarget
                      ? `2px dashed ${divMeta?.accent || '#10b981'}`
                      : `2px solid ${divMeta?.color || (isLight ? '#3b82f6' : 'rgba(3, 5, 186, 0.6)')}`,
                    boxShadow: isDropTarget
                      ? `0 0 0 3px ${isLight ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.4)'}, ${themeStyles.cardShadow}`
                      : themeStyles.cardShadow,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    position: 'relative',
                    opacity: isBeingDragged ? 0.45 : 1,
                    transform: isDropTarget ? 'scale(1.015)' : 'none',
                    transition: 'transform 0.15s ease, opacity 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                  }}
                >
                  {/* Division Header Banner */}
                  <div
                    style={{
                      cursor: isDraggable ? (isBeingDragged ? 'grabbing' : 'grab') : 'default',
                      userSelect: 'none',
                      padding: isCrowded ? '0.55rem 0.75rem' : (isSimultaneous ? '0.65rem 0.9rem' : '0.85rem 1.25rem'),
                      backgroundColor: isLight ? (divMeta?.bgLight || '#edf2f7') : (divMeta?.bgDark || '#1e293b'),
                      borderBottom: `2px solid ${divMeta?.color || (isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)')}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.4rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: isCrowded ? '0.45rem' : '0.65rem', minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          width: isCrowded ? '9px' : (isSimultaneous ? '10px' : '12px'),
                          height: isCrowded ? '9px' : (isSimultaneous ? '10px' : '12px'),
                          borderRadius: '50%',
                          backgroundColor: divMeta?.accent || '#10b981',
                          boxShadow: `0 0 10px ${divMeta?.accent || '#10b981'}`,
                          animation: 'pulse 1.5s infinite',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h2
                          style={{
                            fontSize: isCrowded ? '1.1rem' : (isSimultaneous ? '1.22rem' : '1.35rem'),
                            fontWeight: 900,
                            letterSpacing: '0.03em',
                            textTransform: 'uppercase',
                            color: isLight ? (divMeta?.color || '#0f172a') : '#ffffff',
                            margin: 0,
                            lineHeight: 1.15,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={divMeta?.label || divName}
                        >
                          {divMeta?.label || divName}
                        </h2>
                        {divMeta?.fullName && (
                          <div
                            style={{
                              fontSize: isCrowded ? '0.66rem' : (isSimultaneous ? '0.69rem' : '0.72rem'),
                              color: isLight ? '#475569' : '#94a3b8',
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: isCrowded ? '135px' : (isSimultaneous ? '180px' : '280px'),
                              marginTop: '0.1rem',
                            }}
                            title={divMeta.fullName}
                          >
                            {divMeta.fullName}
                          </div>
                        )}
                      </div>
                    </div>

                    <span
                      style={{
                        fontSize: isCrowded ? '0.7rem' : (isSimultaneous ? '0.74rem' : '0.78rem'),
                        fontWeight: 800,
                        padding: isCrowded ? '0.12rem 0.45rem' : (isSimultaneous ? '0.16rem 0.55rem' : '0.2rem 0.6rem'),
                        borderRadius: '9999px',
                        backgroundColor: divItems.length > 0
                          ? (isLight ? '#dcfce7' : 'rgba(16, 185, 129, 0.25)')
                          : (isLight ? '#edf2f7' : 'rgba(255,255,255,0.08)'),
                        color: divItems.length > 0
                          ? (isLight ? '#047857' : '#34d399')
                          : (isLight ? '#64748b' : '#94a3b8'),
                        border: divItems.length > 0
                          ? (isLight ? '1px solid #86efac' : '1px solid rgba(16, 185, 129, 0.4)')
                          : (isLight ? '1px solid #cbd5e1' : '1px solid rgba(255,255,255,0.1)'),
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          width: '5px',
                          height: '5px',
                          borderRadius: '50%',
                          backgroundColor: divItems.length > 0 ? '#10b981' : '#94a3b8',
                        }}
                      />
                      <span>{divItems.length > 0 ? `${divItems.length} Serving` : 'Waiting'}</span>
                    </span>
                  </div>

                  {/* Division Table / Card Body */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                    {divItems.length > 0 ? (
                      isSimultaneous ? (
                        /* Simultaneous View: Stacked Ticket Cards so Officer & Service have 100% width */
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {divItems.map((item, idx) => (
                            <div
                              key={item.id || idx}
                              style={{
                                padding: scale.cardPadding,
                                borderBottom: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
                                backgroundColor: idx % 2 === 1
                                  ? (isLight ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.02)')
                                  : 'transparent',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: isCrowded ? '0.35rem' : '0.45rem',
                              }}
                            >
                              {/* Row 1: Queue Number on Left, Counter and Serving Badge on Right */}
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '0.4rem',
                              }}>
                                {/* Queue Number */}
                                <div
                                  className="mono"
                                  style={{
                                    fontSize: scale.queueFontSize,
                                    lineHeight: 1,
                                    fontWeight: 900,
                                    color: item.is_priority ? (isLight ? '#b45309' : 'var(--dole-gold)') : themeStyles.queueNoColor,
                                    letterSpacing: '-0.02em',
                                    textShadow: item.is_priority ? (isLight ? 'none' : '0 0 20px rgba(255, 198, 3, 0.35)') : themeStyles.queueNoShadow,
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: '0.25rem',
                                  }}
                                >
                                  <span>{item.queue_no}</span>
                                  {item.is_priority && (
                                    <span style={{ fontSize: '0.85rem', color: isLight ? '#b45309' : 'var(--dole-gold)' }} title="Priority Client">
                                      ★
                                    </span>
                                  )}
                                </div>

                                {/* Counter and Serving Badge */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem' }}>
                                  <div
                                    style={{
                                      fontSize: scale.counterFontSize,
                                      fontWeight: 800,
                                      color: isLight ? '#0f172a' : '#f8fafc',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.03em',
                                      textAlign: 'right',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      maxWidth: isCrowded ? '115px' : '160px',
                                    }}
                                    title={item.counter}
                                  >
                                    {item.counter}
                                  </div>
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.25rem',
                                      fontSize: scale.statusFontSize,
                                      fontWeight: 700,
                                      padding: scale.badgePadding,
                                      borderRadius: '9999px',
                                      backgroundColor: isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.2)',
                                      color: isLight ? '#047857' : '#34d399',
                                    }}
                                  >
                                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                                    <span>Serving</span>
                                  </span>
                                </div>
                              </div>

                              {/* Row 2: Assigned Personnel / Officer */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.35rem',
                                  fontSize: scale.personnelFontSize,
                                  fontWeight: 700,
                                  color: isLight ? '#1e3a8a' : '#93c5fd',
                                  backgroundColor: isLight ? 'rgba(30, 58, 138, 0.05)' : 'rgba(147, 197, 253, 0.08)',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '6px',
                                  border: isLight ? '1px solid rgba(30, 58, 138, 0.12)' : '1px solid rgba(147, 197, 253, 0.12)',
                                  minWidth: 0,
                                }}
                              >
                                <span style={{ fontSize: '0.82rem', flexShrink: 0 }}>👤</span>
                                <span
                                  style={{
                                    wordBreak: 'break-word',
                                    lineHeight: 1.25,
                                    overflow: 'hidden',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                  }}
                                  title={item.assigned_personnel || 'Officer on Duty'}
                                >
                                  {item.assigned_personnel || (
                                    <span style={{ fontStyle: 'italic', fontWeight: 500, color: isLight ? '#64748b' : '#94a3b8' }}>
                                      Officer on Duty
                                    </span>
                                  )}
                                </span>
                              </div>

                              {/* Row 3: Counter Service Name */}
                              {item.service_name && (
                                <div
                                  style={{
                                    fontSize: scale.serviceFontSize,
                                    color: themeStyles.serviceDescColor,
                                    fontWeight: 500,
                                    lineHeight: 1.3,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    padding: '0 0.15rem',
                                  }}
                                  title={item.service_name}
                                >
                                  <span style={{ fontWeight: 700, color: isLight ? '#475569' : '#cbd5e1' }}>Service: </span>
                                  {item.service_name}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        /* Single Division View: Wide Table with Word-Wrap */
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            textAlign: 'left',
                            tableLayout: 'fixed',
                          }}
                        >
                          <thead>
                            <tr
                              style={{
                                backgroundColor: isLight ? '#edf2f7' : 'rgba(255, 255, 255, 0.04)',
                                borderBottom: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.08)',
                              }}
                            >
                              <th style={{ padding: '0.65rem 1rem', fontSize: '0.82rem', fontWeight: 800, color: isLight ? '#334155' : themeStyles.counterLabel, textTransform: 'uppercase', letterSpacing: '0.06em', width: '28%' }}>
                                Queue No.
                              </th>
                              <th style={{ padding: '0.65rem 1rem', fontSize: '0.82rem', fontWeight: 800, color: isLight ? '#334155' : themeStyles.counterLabel, textTransform: 'uppercase', letterSpacing: '0.06em', width: '26%' }}>
                                Counter / Window
                              </th>
                              <th style={{ padding: '0.65rem 1rem', fontSize: '0.82rem', fontWeight: 800, color: isLight ? '#334155' : themeStyles.counterLabel, textTransform: 'uppercase', letterSpacing: '0.06em', width: '46%' }}>
                                Officer & Service
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {divItems.map((item, idx) => (
                              <tr
                                key={item.id || idx}
                                style={{
                                  borderBottom: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.06)',
                                  backgroundColor: idx % 2 === 1
                                    ? (isLight ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.02)')
                                    : 'transparent',
                                }}
                              >
                                {/* Queue Number */}
                                <td style={{ padding: scale.rowPadding, verticalAlign: 'middle' }}>
                                  <div
                                    className="mono"
                                    style={{
                                      fontSize: scale.queueFontSize,
                                      lineHeight: scale.queueLineHeight,
                                      fontWeight: 900,
                                      color: item.is_priority ? (isLight ? '#b45309' : 'var(--dole-gold)') : themeStyles.queueNoColor,
                                      letterSpacing: '-0.02em',
                                      textShadow: item.is_priority ? (isLight ? 'none' : '0 0 20px rgba(255, 198, 3, 0.35)') : themeStyles.queueNoShadow,
                                      display: 'flex',
                                      alignItems: 'baseline',
                                      gap: '0.35rem',
                                    }}
                                  >
                                    <span>{item.queue_no}</span>
                                    {item.is_priority && (
                                      <span style={{ fontSize: '0.9rem', color: isLight ? '#b45309' : 'var(--dole-gold)', verticalAlign: 'middle' }} title="Priority Client">
                                        ★
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* Counter / Window */}
                                <td style={{ padding: scale.rowPadding, verticalAlign: 'middle' }}>
                                  <div
                                    style={{
                                      fontSize: scale.counterFontSize,
                                      fontWeight: 800,
                                      color: isLight ? '#0f172a' : '#f8fafc',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.04em',
                                    }}
                                  >
                                    {item.counter}
                                  </div>
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.25rem',
                                      fontSize: scale.statusFontSize,
                                      fontWeight: 700,
                                      padding: scale.badgePadding,
                                      borderRadius: '9999px',
                                      backgroundColor: isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.2)',
                                      color: isLight ? '#047857' : '#34d399',
                                      marginTop: '0.2rem',
                                    }}
                                  >
                                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                                    <span>Serving</span>
                                  </span>
                                </td>

                                {/* Officer & Service */}
                                <td style={{ padding: scale.rowPadding, verticalAlign: 'middle' }}>
                                  {item.assigned_personnel ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                                      <span style={{ fontSize: '0.95rem' }}>👤</span>
                                      <span
                                        style={{
                                          fontSize: scale.personnelFontSize,
                                          fontWeight: 700,
                                          color: isLight ? '#1e3a8a' : '#93c5fd',
                                          wordBreak: 'break-word',
                                          lineHeight: 1.25,
                                        }}
                                      >
                                        {item.assigned_personnel}
                                      </span>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.25rem', color: isLight ? '#64748b' : '#94a3b8', fontStyle: 'italic', fontSize: scale.personnelFontSize }}>
                                      <span>👤</span>
                                      <span>Officer on Duty</span>
                                    </div>
                                  )}

                                  {item.service_name && (
                                    <div
                                      style={{
                                        fontSize: scale.serviceFontSize,
                                        color: themeStyles.serviceDescColor,
                                        fontWeight: 500,
                                        lineHeight: 1.35,
                                        wordBreak: 'break-word',
                                      }}
                                      title={item.service_name}
                                    >
                                      <span style={{ fontWeight: 700, color: isLight ? '#475569' : '#cbd5e1' }}>Service: </span>
                                      {item.service_name}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    ) : (
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: isCrowded ? '1.75rem 0.75rem' : (isSimultaneous ? '2rem 1rem' : '2.5rem 1.5rem'),
                          color: themeStyles.emptyServingColor,
                          textAlign: 'center',
                        }}
                      >
                        <div
                          style={{
                            width: isCrowded ? '36px' : (isSimultaneous ? '40px' : '44px'),
                            height: isCrowded ? '36px' : (isSimultaneous ? '40px' : '44px'),
                            borderRadius: '50%',
                            backgroundColor: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '0.6rem',
                            color: isLight ? '#94a3b8' : '#64748b',
                          }}
                        >
                          <svg width={isCrowded ? "18" : "20"} height={isCrowded ? "18" : "20"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                          </svg>
                        </div>
                        <div style={{ fontSize: isCrowded ? '0.88rem' : (isSimultaneous ? '0.94rem' : '1rem'), fontWeight: 700, color: isLight ? '#475569' : '#cbd5e1' }}>
                          No Active Serving Queue
                        </div>
                        <div style={{ fontSize: isCrowded ? '0.72rem' : '0.8rem', marginTop: '0.2rem', color: themeStyles.emptyServingColor, lineHeight: 1.35, maxWidth: '200px' }}>
                          Counters are ready for next ticket call at {divMeta?.label || divName}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Division Upcoming Queue Footer */}
                  {divUpcoming.length > 0 && (
                    <div
                      style={{
                        padding: isCrowded ? '0.35rem 0.6rem' : (isSimultaneous ? '0.45rem 0.75rem' : '0.5rem 1rem'),
                        backgroundColor: isLight ? '#edf2f7' : 'rgba(255, 255, 255, 0.03)',
                        borderTop: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.08)',
                        fontSize: isCrowded ? '0.72rem' : (isSimultaneous ? '0.75rem' : '0.8rem'),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.35rem',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: isLight ? '#64748b' : '#94a3b8' }}>
                        {isSimultaneous ? 'Next in line:' : `Next in line for ${divMeta?.label || divName}:`}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {divUpcoming.slice(0, isCrowded ? 3 : 4).map((qNum) => (
                          <span
                            key={qNum}
                            className="mono"
                            style={{
                              padding: '0.1rem 0.35rem',
                              borderRadius: '5px',
                              fontSize: isCrowded ? '0.75rem' : '0.82rem',
                              fontWeight: 800,
                              backgroundColor: qNum.startsWith('P-')
                                ? (isLight ? '#fef3c7' : 'rgba(245, 158, 11, 0.25)')
                                : (isLight ? '#dbeafe' : 'rgba(59, 130, 246, 0.2)'),
                              color: qNum.startsWith('P-')
                                ? (isLight ? '#b45309' : '#fbbf24')
                                : (isLight ? '#1e40af' : '#93c5fd'),
                              border: qNum.startsWith('P-')
                                ? (isLight ? '1px solid #f59e0b' : '1px solid rgba(245, 158, 11, 0.4)')
                                : (isLight ? '1px solid #93c5fd' : '1px solid rgba(59, 130, 246, 0.3)'),
                            }}
                          >
                            {qNum}
                          </span>
                        ))}
                        {divUpcoming.length > (isCrowded ? 3 : 4) && (
                          <span style={{ fontSize: '0.7rem', color: isLight ? '#94a3b8' : '#64748b', fontWeight: 600 }}>
                            +{divUpcoming.length - (isCrowded ? 3 : 4)} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Right Side: NEXT IN LINE & ARTA AWARENESS VIDEO */}
        <section style={{
          backgroundColor: themeStyles.rightSectionBg,
          borderRadius: '16px',
          border: themeStyles.rightSectionBorder,
          boxShadow: themeStyles.rightSectionShadow,
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          overflow: 'hidden',
        }}>
          {/* Top: Upcoming Queue (NEXT IN LINE) */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 auto',
            minHeight: 0,
            maxHeight: '320px',
          }}>
            <div style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: themeStyles.nextTitleColor,
              marginBottom: '0.75rem',
              borderBottom: themeStyles.nextTitleBorder,
              paddingBottom: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span>{t.next_numbers}</span>
              {filteredNextNumbers.length > 0 && (
                <span style={{ fontSize: '0.85rem', color: isLight ? '#64748b' : '#94a3b8', fontWeight: 600 }}>
                  {filteredNextNumbers.length} in line
                </span>
              )}
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.65rem', overflowY: 'auto', paddingRight: '4px' }}>
              {filteredNextNumbers.length > 0 ? (
                filteredNextNumbers.map((num, idx) => (
                  <div key={idx} style={{
                    backgroundColor: themeStyles.nextItemBg,
                    border: themeStyles.nextItemBorder,
                    borderRadius: '10px',
                    padding: '0.75rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderLeft: num.startsWith('P-') ? (isLight ? '5px solid #d97706' : '5px solid var(--dole-gold)') : (isLight ? '5px solid #1e40af' : '5px solid #3b82f6'),
                  }}>
                    <span style={{ fontSize: '1rem', color: isLight ? '#64748b' : '#94a3b8', fontWeight: 600 }}>
                      #{idx + 1}
                    </span>
                    <span className="mono" style={{ fontSize: '1.85rem', fontWeight: 800, color: num.startsWith('P-') ? (isLight ? '#b45309' : 'var(--dole-gold)') : themeStyles.nextItemNumber }}>
                      {num}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', color: themeStyles.emptyServingColor, marginTop: '1.5rem', fontSize: '1.1rem' }}>
                  {t.waiting_empty}
                </div>
              )}
            </div>
          </div>

          {/* Under Upcoming Queue: ARTA Citizen's Charter Video Player */}
          <div style={{
            backgroundColor: '#0b1120',
            borderRadius: '14px',
            border: '1px solid rgba(217, 119, 6, 0.45)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.5)',
            padding: '0.85rem',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.5rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              paddingBottom: '0.4rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '1.1rem' }}>🎥</span>
                <span style={{
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--dole-gold)',
                }}>
                  ARTA · Citizen's Charter
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <button
                  type="button"
                  onClick={() => setShowFolderModal(true)}
                  title="Configure Local Video Folder or Link for ARTA Display"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '9999px',
                    color: '#93c5fd',
                    padding: '0.15rem 0.6rem',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <span>🎬</span>
                  <span>{playlist.length > 0 ? (activeFolderName || 'Video Options') : 'Choose Video'}</span>
                </button>
                <span style={{
                  fontSize: '0.7rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(217, 119, 6, 0.25)',
                  color: '#fef08a',
                  fontWeight: 700,
                  border: '1px solid rgba(255, 198, 3, 0.4)',
                }}>
                  R.A. 11032
                </span>
              </div>
            </div>

            {/* Video Player 16:9 */}
            <div style={{
              position: 'relative',
              width: '100%',
              paddingTop: '56.25%',
              backgroundColor: '#000000',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              {isLocalPlaylistLoading ? (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#0b1120',
                  color: '#94a3b8',
                  gap: '0.65rem',
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    border: '3px solid rgba(59, 130, 246, 0.2)',
                    borderTop: '3px solid #3b82f6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Loading Video...</span>
                </div>
              ) : artaEmbed ? (
                artaEmbed.type === 'youtube' || artaEmbed.type === 'embed' ? (
                  <iframe
                    ref={iframeRef}
                    key={artaEmbed.url}
                    src={artaEmbed.url}
                    title="ARTA Awareness Video"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      border: 'none',
                    }}
                  />
                ) : (
                  <video
                    ref={videoRef}
                    key={artaEmbed.url}
                    src={artaEmbed.url}
                    autoPlay
                    loop={playlist.length <= 1}
                    playsInline
                    controls
                    muted={!audioUnlocked}
                    onPlay={() => {
                      isUserPausedRef.current = false;
                    }}
                    onPause={(e) => {
                      if (!e.target.ended) {
                        isUserPausedRef.current = true;
                      }
                    }}
                    onCanPlay={handleVideoCanPlay}
                    onEnded={playlist.length > 1 ? handleVideoEnded : undefined}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                    }}
                  />
                )
              ) : (
                <div
                  onClick={handleSelectFileClick}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: '1.25rem',
                    textAlign: 'center',
                    backgroundColor: '#0b1120',
                  }}
                >
                  <span style={{ fontSize: '2.5rem', marginBottom: '0.4rem' }}>🎬</span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--dole-gold)', marginBottom: '0.25rem' }}>
                    Click to Upload or Select ARTA Video
                  </span>
                  <span style={{ fontSize: '0.76rem', color: '#cbd5e1', maxWidth: '320px', lineHeight: 1.35, marginBottom: '0.75rem' }}>
                    Choose a video file (.mp4, .webm, .mov) or folder to play on this screen.
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectFileClick();
                      }}
                      style={{
                        backgroundColor: '#10b981',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.4rem 0.85rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      🎬 Choose File...
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectFolderClick();
                      }}
                      style={{
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.4rem 0.85rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      📂 Choose Folder...
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{
              marginTop: '0.4rem',
              fontSize: '0.72rem',
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                {playlist.length > 1
                  ? `Video ${currentIndex + 1}/${playlist.length}: ${currentVideoItem?.name || 'Local Video'}`
                  : (currentVideoItem?.name || (artaEmbed ? "ARTA Video" : "No Video Uploaded"))}
              </span>
              <span style={{ color: artaEmbed ? '#10b981' : '#64748b', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: artaEmbed ? '#10b981' : '#475569' }} />
                {artaEmbed ? (playlist.length > 1 ? `Looping (${playlist.length})` : 'Playing') : 'Idle'}
              </span>
            </div>
          </div>
        </section>
      </div>

      <footer style={{
        marginTop: '1.5rem',
        paddingTop: '1rem',
        borderTop: themeStyles.footerBorder,
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '0.85rem',
        color: themeStyles.footerColor,
      }}>
        <span>DOLE Client Transaction Monitoring System (CTMS)</span>
        <span>Display updates automatically every 5 seconds</span>
      </footer>

      {/* Hidden File Input for Single/Multiple Video File Selection */}
      <input
        ref={singleFileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.ogg,.mov,.mkv,.avi"
        multiple
        onChange={handleSingleFilesSelected}
        style={{ display: 'none' }}
      />

      {/* Hidden File Input for Whole Local Folder Selection */}
      <input
        ref={folderFileInputRef}
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        onChange={handleFolderFilesSelected}
        style={{ display: 'none' }}
      />

      {/* Local Video Folder Configuration Modal */}
      {showFolderModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: '1rem',
        }}>
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid rgba(217, 119, 6, 0.5)',
            borderRadius: '16px',
            padding: '1.75rem',
            maxWidth: '520px',
            width: '100%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
            color: '#ffffff',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--dole-gold)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📁</span> Local Video Folder Configuration
              </h3>
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.25rem', lineHeight: 1.4 }}>
              Play videos sequentially in a continuous loop with <strong>0 server storage used</strong>.
            </p>

            {/* Option A: Select Local Video File(s) or Folder */}
            <div
              style={{
                backgroundColor: '#1e293b',
                border: '2px dashed #3b82f6',
                borderRadius: '12px',
                padding: '1.25rem 1rem',
                textAlign: 'center',
                marginBottom: '1rem',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ fontSize: '2.2rem', marginBottom: '0.25rem' }}>🎬 / 📁</div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: '#60a5fa', marginBottom: '0.25rem' }}>
                Select Video File or Folder
              </div>
              <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '0.85rem', maxWidth: '420px', margin: '0 auto 0.85rem auto', lineHeight: 1.4 }}>
                Choose a video file (.mp4, .webm, .mov) or an entire folder on this computer. Selected video will play automatically and persist across page reloads with <strong>0 server storage used</strong>.
              </div>
              <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleSelectFileClick}
                  style={{
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.65rem 1.15rem',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)',
                  }}
                >
                  <span>🎬</span> Choose Video File...
                </button>
                <button
                  type="button"
                  onClick={handleSelectFolderClick}
                  style={{
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.65rem 1.15rem',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
                  }}
                >
                  <span>📂</span> Choose Video Folder...
                </button>
              </div>
            </div>

            {/* Folder / File Loading Feedback Status */}
            {folderStatusMessage && (
              <div style={{
                marginBottom: '1rem',
                padding: '0.65rem 0.9rem',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                backgroundColor: folderStatusType === 'error'
                  ? 'rgba(239, 68, 68, 0.15)'
                  : (folderStatusType === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)'),
                color: folderStatusType === 'error'
                  ? '#fca5a5'
                  : (folderStatusType === 'success' ? '#6ee7b7' : '#93c5fd'),
                border: `1px solid ${folderStatusType === 'error' ? '#ef4444' : (folderStatusType === 'success' ? '#10b981' : '#3b82f6')}`,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}>
                <span>{folderStatusType === 'error' ? '⚠️' : (folderStatusType === 'success' ? '✅' : 'ℹ️')}</span>
                <span>{folderStatusMessage}</span>
              </div>
            )}

            {/* Option B: Enter Folder Link or URLs */}
            <form onSubmit={handleSaveCustomFolderLink} style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.4rem' }}>
                Or Enter Folder Link / URLs:
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={folderInputVal}
                  onChange={(e) => setFolderInputVal(e.target.value)}
                  placeholder="e.g. http://10.6.50.38/videos/ or C:\Videos or URL"
                  style={{
                    flex: 1,
                    backgroundColor: '#0b1120',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    padding: '0.6rem 0.85rem',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                  }}
                />
                <button
                  type="submit"
                  style={{
                    backgroundColor: 'var(--dole-gold)',
                    color: '#000000',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.6rem 1rem',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Play Link
                </button>
              </div>
            </form>

            {/* Footer controls: default ARTA video or Clear */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <button
                type="button"
                onClick={handleResetToDefaultVideo}
                style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Clear Active Video
              </button>
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#cbd5e1',
                  borderRadius: '6px',
                  padding: '0.35rem 0.85rem',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
