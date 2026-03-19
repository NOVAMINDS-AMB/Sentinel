import React, { useEffect, useState } from 'react';
import { Archive, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import Badge from '../ui/Badge';
import SourceIcon from '../ui/SourceIcon';

const PAGE_SIZE = 50;

const ArchiveView = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');

  const fetchPage = async (offset = 0, replace = true) => {
    if (replace) setLoading(true); else setLoadingMore(true);
    const { data } = await supabase
      .from('notification_metadata')
      .select('*')
      .eq('user_id', user.id)
      .order('received_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    const rows = data || [];
    setNotifications(prev => replace ? rows : [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    if (replace) setLoading(false); else setLoadingMore(false);
  };

  useEffect(() => {
    if (!user) return;
    fetchPage(0, true);
  }, [user]);

  const handleLoadMore = () => fetchPage(notifications.length, false);

  const filtered = notifications.filter(n => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (n.source || '').toLowerCase().includes(q) ||
      (n.notification_type || '').toLowerCase().includes(q) ||
      (n.sender_domain || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Archive className="text-teal-500" size={22} />
        <h1 className="text-xl font-mono font-bold tracking-wider text-primaryText">NOTIFICATION ARCHIVE</h1>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiaryText" size={14} />
        <input
          type="text"
          placeholder="Search by source, type, sender..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-panel border border-hover rounded pl-9 pr-4 py-2.5 text-sm font-mono text-primaryText placeholder-tertiaryText focus:outline-none focus:border-teal-500/50 transition-colors"
        />
      </div>

      {loading ? (
        <p className="font-mono text-tertiaryText text-sm animate-pulse">Loading archive...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Archive className="mx-auto text-tertiaryText opacity-30 mb-4" size={48} />
          <p className="font-mono text-secondaryText">{search ? 'No results found.' : 'Archive is empty.'}</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {filtered.map(n => (
              <div key={n.id} className="bg-panel border border-hover rounded px-4 py-3 flex items-center justify-between hover:bg-hover transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <SourceIcon source={n.source} />
                  <Badge tier={tierFromScore(n.final_score)} label={tierFromScore(n.final_score)} />
                  <div className="min-w-0">
                    <p className="text-sm font-mono text-primaryText truncate">{n.notification_type || 'Notification'}</p>
                    <p className="text-xs text-tertiaryText font-mono">{n.sender_domain || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 ml-3">
                  {n.final_score != null && (
                    <span className={`text-xs font-mono font-bold ${scoreColor(n.final_score)}`}>
                      {Number(n.final_score).toFixed(1)}
                    </span>
                  )}
                  <span className="text-xs text-tertiaryText font-mono hidden sm:block">
                    {formatDate(n.received_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {!search && hasMore && (
            <div className="flex justify-center mt-4">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-6 py-2 bg-panel border border-hover rounded font-mono text-sm text-secondaryText hover:text-primaryText hover:border-teal-500/40 transition-colors disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load 50 more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

function tierFromScore(score) {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

function scoreColor(score) {
  if (score >= 9) return 'text-critical';
  if (score >= 7) return 'text-high';
  if (score >= 5) return 'text-medium';
  return 'text-low';
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default ArchiveView;
