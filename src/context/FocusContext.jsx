import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

const FocusContext = createContext();
const SERVER = 'http://localhost:3001';

export const useFocus = () => useContext(FocusContext);

export const FocusProvider = ({ children }) => {
  const { user } = useAuth();
  const [isFocusGuardianActive, setIsFocusGuardianActive] = useState(false);
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState(3600);
  const [currentProject, setCurrentProject] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [interrupts, setInterrupts] = useState([]);
  const [queuedCounts, setQueuedCounts] = useState({ medium: 0, low: 0 });
  const [queuedItems, setQueuedItems] = useState([]);
  const [summaryData, setSummaryData] = useState({
    handledCritical: [], mediumReview: [], lowCount: 0, focusScore: 0, duration: ''
  });
  const [escalationQueue, setEscalationQueue] = useState([]); // unacknowledged criticals T+5m
  const [mlRefreshTick, setMlRefreshTick] = useState(0);

  const sessionIdRef = useRef(null);
  const sessionStartRef = useRef(null);
  const statsRef = useRef({ received: 0, suppressed: 0 });
  const interruptTimestampsRef = useRef({}); // id → Date.now() when first shown
  const pushedNotificationsRef = useRef(new Set()); // ids that already got a push at T+15
  // Prevent double-restore on mount
  const restoredRef = useRef(false);

  // ── Session persistence: restore active session on page load (5.3.5) ──
  useEffect(() => {
    if (!user || restoredRef.current) return;

    const restoreActiveSession = async () => {
      const { data: session } = await supabase
        .from('focus_sessions')
        .select('id, started_at, duration_minutes, project_name')
        .eq('user_id', user.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!session) return;

      const totalSeconds = (session.duration_minutes || 60) * 60;
      const elapsed = Math.floor((Date.now() - new Date(session.started_at)) / 1000);
      const remaining = totalSeconds - elapsed;

      if (remaining > 0) {
        restoredRef.current = true;
        sessionIdRef.current = session.id;
        sessionStartRef.current = new Date(session.started_at);
        setCurrentProject(session.project_name || 'Deep Work');
        setSessionTimeRemaining(remaining);
        setIsFocusGuardianActive(true);
        console.log('[SESSION] Restored active session, remaining:', remaining + 's');
      } else {
        // Session expired while page was closed — close it out
        await supabase
          .from('focus_sessions')
          .update({ ended_at: new Date().toISOString(), duration_minutes: session.duration_minutes })
          .eq('id', session.id);
      }
    };

    restoreActiveSession();
  }, [user]);

  // ── Load initial notifications from Supabase ──────────────────
  useEffect(() => {
    if (!user) return;

    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from('notification_metadata')
        .select('*, message_excerpts(*)')
        .eq('user_id', user.id)
        .order('received_at', { ascending: false })
        .limit(30);

      if (error) { console.error('Fetch notifications error:', error.message); return; }
      if (data) processNotifications(data, false);
    };

    fetchNotifications();
  }, [user]);

  // ── Real-time subscription ────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('notification_stream')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notification_metadata',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        processNotifications([payload.new], true);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [user]);

  // ── Gmail auto-polling during active session (2.2.7) ──────────
  useEffect(() => {
    if (!isFocusGuardianActive || !user) return;

    const pollGmail = async () => {
      try {
        await fetch(`${SERVER}/integrations/gmail/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user.id })
        });
      } catch (e) {
        // Silent fail — don't crash the session on poll errors
      }
    };

    pollGmail(); // immediate poll on session start/restore
    const interval = setInterval(pollGmail, 60000);
    return () => clearInterval(interval);
  }, [isFocusGuardianActive, user]);

  const processNotifications = (notifications, isRealtime = false) => {
    const newInterrupts = [];
    const newQueuedItems = [];
    let newMedium = 0;
    let newLow = 0;

    notifications.forEach(n => {
      const score = n.final_score ?? 0;
      const excerpt = n.message_excerpts?.[0]?.encrypted_excerpt || n.sender_domain || '';
      // Use server-assigned action_taken so per-user thresholds are honoured.
      // Fall back to score-based heuristic only for legacy rows without action_taken.
      const action = n.action_taken || (score >= 7 ? 'interrupt' : score >= 5 ? 'queued' : 'suppressed');

      if (isRealtime) {
        statsRef.current.received++;
        if (action === 'suppressed') statsRef.current.suppressed++;
      }

      if (action === 'interrupt') {
        newInterrupts.push({
          id: n.id,
          source: n.source,
          type: score >= 9 ? 'critical' : 'high',
          title: n.notification_type,
          excerpt,
          sender: n.sender_domain || 'unknown',
          timeAgo: isRealtime ? 'Just now' : formatTimeAgo(n.received_at),
          score
        });
      } else if (action === 'queued') {
        newMedium++;
        newQueuedItems.push({
          id: n.id,
          source: n.source,
          tier: score >= 7 ? 'medium' : 'low',
          title: n.notification_type,
          sender: n.sender_domain || 'unknown',
          timeAgo: isRealtime ? 'Just now' : formatTimeAgo(n.received_at),
          score
        });
      } else {
        // suppressed — count only, don't show in UI
        newLow++;
      }
    });

    if (newInterrupts.length > 0) {
      // Record when each interrupt first appeared (for escalation timing)
      const now = Date.now();
      newInterrupts.forEach(i => {
        if (!interruptTimestampsRef.current[i.id]) {
          interruptTimestampsRef.current[i.id] = now;
        }
      });
      setInterrupts(prev => [...newInterrupts, ...prev].slice(0, 10));
    }
    if (newMedium > 0 || newLow > 0) {
      setQueuedCounts(prev => ({
        medium: prev.medium + newMedium,
        low: prev.low + newLow
      }));
    }
    if (newQueuedItems.length > 0) {
      setQueuedItems(prev => [...newQueuedItems, ...prev].slice(0, 50));
    }
  };

  // ── Timer ────────────────────────────────────────────────────
  useEffect(() => {
    let timer;
    if (isFocusGuardianActive && sessionTimeRemaining > 0) {
      timer = setInterval(() => {
        setSessionTimeRemaining(prev => prev - 1);
      }, 1000);
    } else if (isFocusGuardianActive && sessionTimeRemaining === 0) {
      endSession();
    }
    return () => clearInterval(timer);
  }, [isFocusGuardianActive, sessionTimeRemaining]);

  // ── Escalation: promote unacknowledged criticals after 5 min ──
  // Also fire browser push at T+15min (3.3.7)
  useEffect(() => {
    if (!isFocusGuardianActive) return;
    const ESCALATION_MS = 5 * 60 * 1000;
    const PUSH_MS = 15 * 60 * 1000;
    const check = setInterval(() => {
      const now = Date.now();
      setInterrupts(current => {
        const toEscalate = current.filter(i =>
          i.score >= 9 &&
          interruptTimestampsRef.current[i.id] &&
          now - interruptTimestampsRef.current[i.id] >= ESCALATION_MS
        );
        if (toEscalate.length > 0) {
          setEscalationQueue(prev => {
            const existingIds = new Set(prev.map(e => e.id));
            const newOnes = toEscalate.filter(i => !existingIds.has(i.id));
            return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
          });
        }

        // Browser push at T+15min for still-unacknowledged criticals (3.3.7)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          current.forEach(i => {
            if (
              i.score >= 9 &&
              interruptTimestampsRef.current[i.id] &&
              now - interruptTimestampsRef.current[i.id] >= PUSH_MS &&
              !pushedNotificationsRef.current.has(i.id)
            ) {
              pushedNotificationsRef.current.add(i.id);
              new Notification('Sentinel — Critical Unacknowledged', {
                body: `"${i.title}" from ${i.sender} — still waiting 15+ min.`,
                icon: '/favicon.ico',
                tag: `sentinel-critical-${i.id}`
              });
            }
          });
        }

        return current;
      });
    }, 30000); // check every 30s
    return () => clearInterval(check);
  }, [isFocusGuardianActive]);

  // ── Start session ─────────────────────────────────────────────
  const startSession = async (durationMinutes, project) => {
    const projectName = project || 'Deep Work';
    restoredRef.current = true; // prevent restore overwriting a just-started session
    setSessionTimeRemaining(durationMinutes * 60);
    setCurrentProject(projectName);
    setIsFocusGuardianActive(true);
    setShowSummary(false);
    setInterrupts([]);
    setQueuedCounts({ medium: 0, low: 0 });
    setQueuedItems([]);
    setEscalationQueue([]);
    interruptTimestampsRef.current = {};
    pushedNotificationsRef.current = new Set();
    statsRef.current = { received: 0, suppressed: 0 };
    sessionStartRef.current = new Date();

    // Request browser push permission for T+15min escalations (3.3.7)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    if (user) {
      const { data } = await supabase
        .from('focus_sessions')
        .insert({
          user_id: user.id,
          started_at: sessionStartRef.current.toISOString(),
          project_name: projectName,
          duration_minutes: durationMinutes, // stored upfront for session restore
          retention_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        })
        .select()
        .single();

      if (data) sessionIdRef.current = data.id;
    }
  };

  // ── End session ───────────────────────────────────────────────
  const endSession = async () => {
    setIsFocusGuardianActive(false);

    const startTime = sessionStartRef.current || new Date();
    const endTime = new Date();
    const durationMinutes = Math.round((endTime - startTime) / 60000);

    // Pull real notification data from DB for the session window (6.1.5 / 6.1.6)
    let handledCritical = [];
    let mediumReview = [];
    let dbLowCount = 0;
    let dbReceived = 0;
    let dbSuppressed = 0;

    if (user && sessionStartRef.current) {
      const { data: sessionNotifs } = await supabase
        .from('notification_metadata')
        .select('id, notification_type, sender_domain, source, action_taken, final_score, message_excerpts(encrypted_excerpt)')
        .eq('user_id', user.id)
        .gte('received_at', sessionStartRef.current.toISOString())
        .lte('received_at', endTime.toISOString())
        .order('final_score', { ascending: false });

      if (sessionNotifs?.length) {
        dbReceived = sessionNotifs.length;
        dbSuppressed = sessionNotifs.filter(n => n.action_taken === 'suppressed').length;
        dbLowCount = sessionNotifs.filter(n => n.action_taken === 'suppressed').length;

        handledCritical = sessionNotifs
          .filter(n => n.action_taken === 'interrupt')
          .map(n => ({
            id: n.id,
            title: n.notification_type,
            response: 'Acknowledged during session.'
          }));

        // For queued items, fetch AI drafts (6.2.2 / 6.2.3)
        const queuedNotifs = sessionNotifs.filter(n => n.action_taken === 'queued');
        let draftsMap = {};

        if (queuedNotifs.length > 0) {
          try {
            const resp = await fetch(`${SERVER}/session/drafts`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: user.id,
                notification_ids: queuedNotifs.map(n => n.id)
              })
            });
            if (resp.ok) {
              const { drafts } = await resp.json();
              drafts?.forEach(d => { draftsMap[d.notification_id] = d.draft; });
            }
          } catch (e) {
            console.warn('Draft generation failed, using fallback suggestions');
          }
        }

        mediumReview = queuedNotifs.map(n => ({
          id: n.id,
          source: n.source,
          sender: n.sender_domain || 'unknown',
          title: n.notification_type,
          excerpt: n.message_excerpts?.[0]?.encrypted_excerpt || '',
          suggestion: draftsMap[n.id] || `Thanks for reaching out. I was in a focus session and will follow up shortly regarding "${n.notification_type}".`
        }));
      }
    }

    // Fallback to in-memory state if DB query returned nothing
    if (dbReceived === 0) {
      dbReceived = statsRef.current.received || 1;
      dbSuppressed = statsRef.current.suppressed;
      dbLowCount = queuedCounts.low;
      handledCritical = interrupts
        .filter(i => i.score >= 9)
        .map(i => ({ id: i.id, title: i.title, response: 'Acknowledged during session.' }));
      mediumReview = interrupts
        .filter(i => i.score >= 7 && i.score < 9)
        .map(i => ({
          id: i.id,
          source: i.source,
          sender: i.sender,
          title: i.title,
          excerpt: i.excerpt,
          suggestion: `Thanks for reaching out. I was in a focus session and will follow up shortly regarding "${i.title}".`
        }));
    }

    // Focus score: pristine (no notifications) = 10; otherwise suppression-rate based
    let focusScore;
    if (dbReceived === 0) {
      focusScore = 10;
    } else {
      const suppressionRate = dbSuppressed / dbReceived;
      const interruptPenalty = Math.min(2, handledCritical.length * 0.5);
      focusScore = Math.min(10, Math.max(0,
        (suppressionRate * 8) + (handledCritical.length === 0 ? 2 : Math.max(0, 2 - interruptPenalty))
      ));
    }

    const summary = {
      handledCritical,
      mediumReview,
      lowCount: dbLowCount,
      focusScore: parseFloat(focusScore.toFixed(1)),
      duration: formatDuration(durationMinutes)
    };

    setSummaryData(summary);
    setShowSummary(true);

    // Count auto-replies sent during this session
    let autoResponsesSent = 0;
    if (user && sessionStartRef.current) {
      const { count } = await supabase
        .from('auto_response_drafts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'sent')
        .gte('created_at', sessionStartRef.current.toISOString())
        .lte('created_at', endTime.toISOString());
      autoResponsesSent = count ?? 0;
    }

    // Persist to Supabase
    if (user && sessionIdRef.current) {
      await supabase
        .from('focus_sessions')
        .update({
          ended_at: endTime.toISOString(),
          duration_minutes: durationMinutes,
          focus_score: focusScore,
          notifications_received: dbReceived,
          notifications_suppressed: dbSuppressed,
          auto_responses_sent: autoResponsesSent
        })
        .eq('id', sessionIdRef.current);
    }

    restoredRef.current = false;
  };

  const closeSummary = () => {
    setShowSummary(false);
    setInterrupts([]);
    setQueuedCounts({ medium: 0, low: 0 });
    setQueuedItems([]);
    setEscalationQueue([]);
    interruptTimestampsRef.current = {};
    pushedNotificationsRef.current = new Set();
    sessionIdRef.current = null;
    sessionStartRef.current = null;
    statsRef.current = { received: 0, suppressed: 0 };
  };

  const acknowledgeEscalation = useCallback((id) => {
    setEscalationQueue(prev => prev.filter(i => i.id !== id));
    setInterrupts(prev => prev.filter(i => i.id !== id));
  }, []);

  const bumpMlRefresh = useCallback(() => {
    setMlRefreshTick(t => t + 1);
  }, []);

  const extendSession = (minutes = 15) => {
    setSessionTimeRemaining(prev => prev + minutes * 60);
  };

  return (
    <FocusContext.Provider value={{
      isFocusGuardianActive, sessionTimeRemaining, currentProject, showSummary,
      interrupts, queuedCounts, queuedItems, summaryData,
      escalationQueue, mlRefreshTick,
      startSession, endSession, closeSummary, extendSession,
      acknowledgeEscalation, bumpMlRefresh
    }}>
      {children}
    </FocusContext.Provider>
  );
};

// ── Helpers ───────────────────────────────────────────────────────
function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
