import React, { useEffect, useState } from 'react';
import { Clock, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import Badge from '../ui/Badge';
import SourceIcon from '../ui/SourceIcon';

const SERVER = 'http://localhost:3001';

const FocusSessionsView = () => {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({}); // sessionId → bool
  const [sessionNotifs, setSessionNotifs] = useState({}); // sessionId → array | 'loading'

  useEffect(() => {
    if (!user) return;
    supabase
      .from('focus_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setSessions(data || []);
        setLoading(false);
      });
  }, [user]);

  const toggleExpand = async (session) => {
    const id = session.id;
    const isOpen = expanded[id];

    setExpanded(prev => ({ ...prev, [id]: !isOpen }));
    if (isOpen || sessionNotifs[id]) return;

    setSessionNotifs(prev => ({ ...prev, [id]: 'loading' }));
    try {
      const res = await fetch(`${SERVER}/sessions/${id}/notifications?user_id=${user.id}`);
      const data = await res.json();
      setSessionNotifs(prev => ({ ...prev, [id]: Array.isArray(data) ? data : [] }));
    } catch {
      setSessionNotifs(prev => ({ ...prev, [id]: [] }));
    }
  };

  const avgScore = sessions.length
    ? (sessions.reduce((s, r) => s + (r.focus_score || 0), 0) / sessions.length).toFixed(1)
    : null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Clock className="text-teal-500" size={22} />
        <h1 className="text-xl font-mono font-bold tracking-wider text-primaryText">FOCUS SESSIONS</h1>
      </div>

      {/* Stats row */}
      {sessions.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Total Sessions" value={sessions.length} />
          <StatCard label="Avg Focus Score" value={avgScore ? `${avgScore}/10` : '—'} />
          <StatCard
            label="Total Time"
            value={formatTotalMinutes(sessions.reduce((s, r) => s + (r.duration_minutes || 0), 0))}
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-panel border border-hover rounded p-4 animate-pulse h-16" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-20">
          <Clock className="mx-auto text-tertiaryText opacity-30 mb-4" size={48} />
          <p className="font-mono text-secondaryText">No focus sessions yet.</p>
          <p className="font-mono text-tertiaryText text-sm mt-1">Start your first session from the Active Overview.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => {
            const isOpen = expanded[s.id];
            const notifs = sessionNotifs[s.id];

            return (
              <div key={s.id} className="bg-panel border border-hover rounded overflow-hidden">
                {/* Session row */}
                <button
                  onClick={() => toggleExpand(s)}
                  className="w-full flex items-center justify-between p-4 hover:bg-hover transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ShieldCheck className={s.focus_score >= 8 ? 'text-success shrink-0' : 'text-medium shrink-0'} size={16} />
                    <div className="min-w-0">
                      <p className="font-mono font-bold text-primaryText text-sm">{s.project_name || 'Deep Work'}</p>
                      <p className="text-xs text-tertiaryText font-mono mt-0.5">
                        {formatDate(s.started_at)}
                        {s.duration_minutes ? ` · ${formatDuration(s.duration_minutes)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 ml-3">
                    {s.notifications_received != null && (
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-tertiaryText font-mono">Notifications</p>
                        <p className="text-sm font-mono text-primaryText">
                          {s.notifications_suppressed ?? 0}/{s.notifications_received ?? 0} suppressed
                        </p>
                      </div>
                    )}
                    {s.focus_score != null && (
                      <div className="text-right">
                        <p className="text-xs text-tertiaryText font-mono">Score</p>
                        <p className={`text-lg font-mono font-bold ${scoreColor(s.focus_score)}`}>
                          {s.focus_score.toFixed(1)}
                        </p>
                      </div>
                    )}
                    {isOpen ? <ChevronUp size={14} className="text-tertiaryText" /> : <ChevronDown size={14} className="text-tertiaryText" />}
                  </div>
                </button>

                {/* Expanded notification list */}
                {isOpen && (
                  <div className="border-t border-hover">
                    {notifs === 'loading' ? (
                      <div className="p-4 space-y-2">
                        {[1, 2].map(i => <div key={i} className="h-8 bg-hover rounded animate-pulse" />)}
                      </div>
                    ) : !notifs || notifs.length === 0 ? (
                      <p className="p-4 text-xs font-mono text-tertiaryText">No notifications recorded for this session.</p>
                    ) : (
                      <div className="divide-y divide-hover">
                        {notifs.map(n => (
                          <div key={n.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-hover/50 transition-colors">
                            <div className="flex items-center gap-2 min-w-0">
                              <SourceIcon source={n.source} size={12} />
                              <Badge tier={tierFromScore(n.final_score)} label={n.action_taken || tierFromScore(n.final_score)} />
                              <span className="text-xs font-mono text-primaryText truncate">{n.notification_type || 'Notification'}</span>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                              <span className="text-xs font-mono text-tertiaryText hidden sm:block">{n.sender_domain || '—'}</span>
                              {n.final_score != null && (
                                <span className={`text-xs font-mono font-bold ${scoreColor(n.final_score)}`}>
                                  {Number(n.final_score).toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value }) => (
  <div className="bg-panel border border-hover rounded p-4">
    <p className="text-[10px] text-tertiaryText font-mono uppercase tracking-wider mb-1">{label}</p>
    <p className="text-xl font-mono font-bold text-primaryText">{value}</p>
  </div>
);

function tierFromScore(score) {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

function scoreColor(score) {
  if (score >= 8) return 'text-success';
  if (score >= 6) return 'text-teal-400';
  return 'text-medium';
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTotalMinutes(total) {
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default FocusSessionsView;
