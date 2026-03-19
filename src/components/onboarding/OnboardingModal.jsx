import React, { useState } from 'react';
import { Shield, ChevronRight, Plus, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const ROLES = ['Developer', 'Designer', 'Manager', 'Freelancer', 'Student', 'Job Seeker', 'Other'];
const KEYWORD_SUGGESTIONS = ['urgent', 'interview', 'production', 'client', 'deadline', 'offer', 'payment', 'incident'];

const SERVER = 'http://localhost:3001';

const OnboardingModal = ({ onComplete }) => {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [role, setRole] = useState('');
  const [vipInput, setVipInput] = useState('');
  const [vipSenders, setVipSenders] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [focusStart, setFocusStart] = useState(9);
  const [focusEnd, setFocusEnd] = useState(17);
  const [autoReply, setAutoReply] = useState(true);
  const [saving, setSaving] = useState(false);

  const addVip = () => {
    const v = vipInput.trim();
    if (v && !vipSenders.includes(v)) setVipSenders(prev => [...prev, v]);
    setVipInput('');
  };

  const addKeyword = (kw) => {
    if (kw && !keywords.includes(kw)) setKeywords(prev => [...prev, kw]);
    setKeywordInput('');
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await fetch(`${SERVER}/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          role,
          vip_senders: vipSenders,
          focus_keywords: keywords,
          focus_hours_start: focusStart,
          focus_hours_end: focusEnd,
          auto_reply_enabled: autoReply
        })
      });
      onComplete();
    } catch (e) {
      console.error('Onboarding save failed:', e);
      onComplete(); // proceed anyway
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-panel border border-hover rounded-lg w-full max-w-lg shadow-2xl">

        {/* Header */}
        <div className="p-6 border-b border-hover flex items-center gap-3">
          <Shield className="text-teal-500" size={24} />
          <div>
            <h2 className="font-mono font-bold text-primaryText tracking-wider">CALIBRATING SENTINEL</h2>
            <p className="text-xs text-tertiaryText font-mono">Step {step} of 3 — building your priority profile</p>
          </div>
        </div>

        <div className="p-6 min-h-[280px]">

          {/* Step 1: Role */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-secondaryText font-mono">What's your primary role? Sentinel uses this as the base scoring profile to handle the cold start.</p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                {ROLES.map(r => (
                  <button key={r} onClick={() => setRole(r)}
                    className={`py-2.5 px-4 rounded font-mono text-sm border transition-all ${role === r ? 'bg-teal-500/20 border-teal-500 text-teal-400' : 'border-hover text-secondaryText hover:border-teal-500/50 hover:text-primaryText'}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: VIPs + Keywords */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-mono text-secondaryText mb-3">Who should always reach you? (name, email, or phone)</p>
                <div className="flex gap-2">
                  <input value={vipInput} onChange={e => setVipInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addVip()}
                    placeholder="e.g. boss@company.com"
                    className="flex-1 bg-base border border-hover rounded px-3 py-2 text-sm font-mono text-primaryText focus:outline-none focus:border-teal-500" />
                  <button onClick={addVip} className="px-3 py-2 bg-teal-500/20 text-teal-400 rounded hover:bg-teal-500/30 transition-colors">
                    <Plus size={16} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {vipSenders.map(v => (
                    <span key={v} className="flex items-center gap-1 px-2 py-1 bg-teal-500/10 text-teal-400 border border-teal-500/30 rounded text-xs font-mono">
                      {v} <button onClick={() => setVipSenders(p => p.filter(x => x !== v))}><X size={10} /></button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-mono text-secondaryText mb-3">Keywords that signal urgency for <em>you</em>:</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {KEYWORD_SUGGESTIONS.map(kw => (
                    <button key={kw} onClick={() => addKeyword(kw)}
                      className={`px-2.5 py-1 rounded text-xs font-mono border transition-all ${keywords.includes(kw) ? 'bg-high/20 border-high text-high' : 'border-hover text-tertiaryText hover:border-high/50'}`}>
                      {kw}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input value={keywordInput} onChange={e => setKeywordInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addKeyword(keywordInput.trim())}
                    placeholder="Add custom keyword..."
                    className="flex-1 bg-base border border-hover rounded px-3 py-2 text-sm font-mono text-primaryText focus:outline-none focus:border-teal-500" />
                  <button onClick={() => addKeyword(keywordInput.trim())} className="px-3 py-2 bg-hover text-secondaryText rounded hover:bg-panel transition-colors">
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Focus hours + auto-reply */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-mono text-secondaryText mb-4">When do you typically do deep work? Sentinel will auto-activate during these hours.</p>
                <div className="flex items-center gap-4">
                  <div>
                    <label className="text-xs font-mono text-tertiaryText uppercase tracking-wider block mb-1">From</label>
                    <select value={focusStart} onChange={e => setFocusStart(Number(e.target.value))}
                      className="bg-base border border-hover rounded px-3 py-2 font-mono text-sm text-primaryText focus:outline-none focus:border-teal-500">
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{i.toString().padStart(2,'0')}:00</option>
                      ))}
                    </select>
                  </div>
                  <span className="text-tertiaryText font-mono mt-5">→</span>
                  <div>
                    <label className="text-xs font-mono text-tertiaryText uppercase tracking-wider block mb-1">To</label>
                    <select value={focusEnd} onChange={e => setFocusEnd(Number(e.target.value))}
                      className="bg-base border border-hover rounded px-3 py-2 font-mono text-sm text-primaryText focus:outline-none focus:border-teal-500">
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{i.toString().padStart(2,'0')}:00</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-base rounded border border-hover p-4">
                <div className="flex-1">
                  <p className="text-sm font-mono text-primaryText">Enable AI auto-replies</p>
                  <p className="text-xs text-tertiaryText font-mono mt-1">For low-priority messages, Sentinel will reply on your behalf with a managed absence message and log every action.</p>
                </div>
                <button onClick={() => setAutoReply(!autoReply)}
                  className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 ${autoReply ? 'bg-teal-500' : 'bg-hover'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${autoReply ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-hover flex justify-between items-center">
          <div className="flex gap-1.5">
            {[1,2,3].map(s => (
              <div key={s} className={`w-6 h-1.5 rounded-full transition-colors ${s <= step ? 'bg-teal-500' : 'bg-hover'}`} />
            ))}
          </div>
          <div className="flex gap-3">
            {step > 1 && (
              <button onClick={() => setStep(s => s - 1)} className="px-4 py-2 text-sm font-mono text-secondaryText hover:text-primaryText transition-colors">
                Back
              </button>
            )}
            {step < 3 ? (
              <button onClick={() => setStep(s => s + 1)} disabled={step === 1 && !role}
                className="flex items-center gap-2 px-5 py-2 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded font-mono text-sm hover:bg-teal-500/30 transition-all disabled:opacity-40">
                Next <ChevronRight size={16} />
              </button>
            ) : (
              <button onClick={handleFinish} disabled={saving}
                className="flex items-center gap-2 px-6 py-2 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded font-mono text-sm font-bold hover:bg-teal-500/30 transition-all disabled:opacity-50">
                {saving ? 'SAVING...' : 'ACTIVATE SENTINEL'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;
