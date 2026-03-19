import React, { useEffect, useState } from 'react';
import { Settings, Brain, Star, Ban, Zap, Save, Plus, X, Sliders, UserCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

const SERVER = 'http://localhost:3001';

const RulesView = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [vipInput, setVipInput] = useState('');
  const [blockInput, setBlockInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [vipList, setVipList] = useState([]);
  const [blockList, setBlockList] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [autoReply, setAutoReply] = useState(true);
  const [thresholdInterrupt, setThresholdInterrupt] = useState(7);
  const [thresholdQueue, setThresholdQueue] = useState(5);
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_onboarding')
      .select('role')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => { if (data?.role) setUserRole(data.role); });
    fetch(`${SERVER}/ml/profile/${user.id}`)
      .then(r => r.json())
      .then(data => {
        setProfile(data.profile);
        setVipList(data.profile?.vip_senders || []);
        setBlockList(data.profile?.blocked_senders || []);
        setKeywords(data.profile?.priority_keywords || []);
        setAutoReply(data.profile?.auto_reply_enabled !== false);
        setThresholdInterrupt(data.profile?.threshold_interrupt ?? 7);
        setThresholdQueue(data.profile?.threshold_queue ?? 5);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user]);

  const addToList = (list, setList, value, setInput) => {
    const trimmed = value.trim();
    if (!trimmed || list.includes(trimmed)) return;
    setList(prev => [...prev, trimmed]);
    setInput('');
  };

  const removeFromList = (list, setList, value) => {
    setList(list.filter(v => v !== value));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${SERVER}/ml/profile/${user.id}/rules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vip_senders: vipList,
          blocked_senders: blockList,
          priority_keywords: keywords,
          auto_reply_enabled: autoReply,
          threshold_interrupt: thresholdInterrupt,
          threshold_queue: thresholdQueue
        })
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  if (loading) return (
    <div className="max-w-2xl mx-auto pt-10">
      <p className="font-mono text-tertiaryText text-sm animate-pulse">Loading rules...</p>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Settings className="text-teal-500" size={22} />
          <h1 className="text-xl font-mono font-bold tracking-wider text-primaryText">RULES & AI</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded font-mono text-xs font-bold tracking-wider hover:bg-teal-500/30 transition-colors disabled:opacity-50"
        >
          <Save size={13} />
          {saved ? 'SAVED!' : saving ? 'SAVING...' : 'SAVE CHANGES'}
        </button>
      </div>

      {/* ML Status */}
      {profile && (
        <div className="bg-panel border border-hover rounded p-4 mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Brain className="text-teal-500 flex-shrink-0" size={18} />
            <div className="text-sm font-mono">
              <span className="text-secondaryText">AI Model: </span>
              <span className="text-primaryText font-bold">{profile.total_interactions >= 50 ? 'Calibrated' : profile.total_interactions >= 15 ? 'Learning' : 'Cold Start'}</span>
              <span className="text-tertiaryText ml-3">{profile.total_interactions || 0} interactions recorded</span>
            </div>
          </div>
          {userRole && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-tertiaryText flex-shrink-0">
              <UserCircle size={13} className="text-teal-500/70" />
              <span className="capitalize">{userRole.replace(/_/g, ' ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Score Thresholds */}
      <Section icon={<Sliders size={16} className="text-teal-400" />} title="Routing Thresholds">
        <p className="text-xs text-tertiaryText font-mono mb-4">
          Adjust the score cutoffs that determine how notifications are routed.
        </p>
        <div className="space-y-5">
          <ThresholdSlider
            label="Interrupt threshold"
            description="Score at or above this interrupts your session immediately."
            color="text-critical"
            trackColor="bg-critical"
            value={thresholdInterrupt}
            min={5} max={10} step={0.5}
            onChange={setThresholdInterrupt}
          />
          <ThresholdSlider
            label="Queue threshold"
            description="Score at or above this is queued for end-of-session review."
            color="text-medium"
            trackColor="bg-medium"
            value={thresholdQueue}
            min={2} max={thresholdInterrupt - 0.5} step={0.5}
            onChange={v => setThresholdQueue(Math.min(v, thresholdInterrupt - 0.5))}
          />
          <div className="flex gap-2 text-[10px] font-mono text-tertiaryText pt-1 border-t border-hover">
            <span className="text-low font-bold">LOW</span>
            <span className="flex-1 text-center">← score →</span>
            <span className="text-medium font-bold">QUEUE at {thresholdQueue}</span>
            <span className="mx-1">·</span>
            <span className="text-critical font-bold">INTERRUPT at {thresholdInterrupt}</span>
          </div>
        </div>
      </Section>

      {/* Auto-reply toggle */}
      <Section icon={<Zap size={16} className="text-medium" />} title="Auto-Reply for Low Priority">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="text-sm font-mono text-primaryText">Managed Absence Replies</p>
            <p className="text-xs text-tertiaryText font-mono mt-0.5">
              Automatically respond to low-priority senders during focus sessions
            </p>
          </div>
          <div
            onClick={() => setAutoReply(!autoReply)}
            className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ml-4 ${autoReply ? 'bg-teal-500' : 'bg-hover'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoReply ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </div>
        </label>
      </Section>

      {/* VIP Senders */}
      <Section icon={<Star size={16} className="text-teal-400" />} title="VIP Senders">
        <p className="text-xs text-tertiaryText font-mono mb-3">
          Notifications from these senders are always scored 8+ regardless of content.
        </p>
        <ChipInput
          value={vipInput}
          onChange={setVipInput}
          onAdd={() => addToList(vipList, setVipList, vipInput, setVipInput)}
          placeholder="e.g. boss@company.com or @cto"
        />
        <ChipList items={vipList} color="text-teal-400 bg-teal-500/10 border-teal-500/20" onRemove={v => removeFromList(vipList, setVipList, v)} />
      </Section>

      {/* Blocked Senders */}
      <Section icon={<Ban size={16} className="text-critical" />} title="Blocked Senders">
        <p className="text-xs text-tertiaryText font-mono mb-3">
          Notifications from these senders are always scored 1 (auto-dismissed as noise).
        </p>
        <ChipInput
          value={blockInput}
          onChange={setBlockInput}
          onAdd={() => addToList(blockList, setBlockList, blockInput, setBlockInput)}
          placeholder="e.g. noreply@newsletter.com"
        />
        <ChipList items={blockList} color="text-critical bg-critical/10 border-critical/20" onRemove={v => removeFromList(blockList, setBlockList, v)} />
      </Section>

      {/* Priority Keywords */}
      <Section icon={<Zap size={16} className="text-high" />} title="Priority Keywords">
        <p className="text-xs text-tertiaryText font-mono mb-3">
          Messages containing these words get a +1 urgency boost.
        </p>
        <ChipInput
          value={keywordInput}
          onChange={setKeywordInput}
          onAdd={() => addToList(keywords, setKeywords, keywordInput, setKeywordInput)}
          placeholder="e.g. urgent, production, deploy"
        />
        <ChipList items={keywords} color="text-high bg-high/10 border-high/20" onRemove={v => removeFromList(keywords, setKeywords, v)} />
      </Section>
    </div>
  );
};

const Section = ({ icon, title, children }) => (
  <div className="bg-panel border border-hover rounded p-5 mb-4">
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <h3 className="font-mono font-bold text-sm tracking-wide text-primaryText uppercase">{title}</h3>
    </div>
    {children}
  </div>
);

const ChipInput = ({ value, onChange, onAdd, placeholder }) => (
  <div className="flex gap-2 mb-3">
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && onAdd()}
      placeholder={placeholder}
      className="flex-1 bg-base border border-hover rounded px-3 py-2 text-sm font-mono text-primaryText placeholder-tertiaryText focus:outline-none focus:border-teal-500/50 transition-colors"
    />
    <button
      onClick={onAdd}
      className="px-3 py-2 bg-hover hover:bg-white/10 rounded text-primaryText transition-colors"
    >
      <Plus size={14} />
    </button>
  </div>
);

const ChipList = ({ items, color, onRemove }) => {
  if (!items.length) return <p className="text-xs text-tertiaryText font-mono italic">None added yet.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(item => (
        <span key={item} className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-mono ${color}`}>
          {item}
          <button onClick={() => onRemove(item)} className="opacity-60 hover:opacity-100 transition-opacity">
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  );
};

const ThresholdSlider = ({ label, description, color, value, min, max, step, onChange }) => (
  <div>
    <div className="flex justify-between items-baseline mb-1">
      <span className="text-xs font-mono text-primaryText">{label}</span>
      <span className={`text-sm font-mono font-bold ${color}`}>{value}/10</span>
    </div>
    <input
      type="range"
      min={min} max={max} step={step}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full h-1.5 rounded-full appearance-none bg-hover cursor-pointer accent-teal-500"
    />
    <p className="text-[10px] text-tertiaryText font-mono mt-1">{description}</p>
  </div>
);

export default RulesView;
