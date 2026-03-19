import React, { useState } from 'react';
import { useFocus } from '../../context/FocusContext';
import { Play, Square, TimerReset, AlertTriangle, Clock } from 'lucide-react';

const SessionControls = () => {
  const { isFocusGuardianActive, startSession, endSession, extendSession } = useFocus();
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');

  const handleCustomStart = () => {
    const mins = parseInt(customMinutes, 10);
    if (!mins || mins < 1 || mins > 480) return;
    startSession(mins, 'Deep Work');
    setCustomMinutes('');
  };

  if (isFocusGuardianActive) {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => extendSession(15)}
          className="flex items-center gap-2 px-4 py-2 bg-hover text-secondaryText rounded font-mono text-sm hover:bg-panel transition-colors"
        >
          <TimerReset size={16} />
          +15M
        </button>

        {confirmingEnd ? (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded px-4 py-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <span className="text-red-400 font-mono text-xs font-bold">End session?</span>
            <button
              onClick={() => { setConfirmingEnd(false); endSession(); }}
              className="px-2 py-0.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded font-mono text-xs font-bold transition-colors"
            >
              YES
            </button>
            <button
              onClick={() => setConfirmingEnd(false)}
              className="px-2 py-0.5 bg-hover text-secondaryText hover:text-primaryText rounded font-mono text-xs transition-colors"
            >
              NO
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingEnd(true)}
            className="flex items-center gap-2 px-5 py-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded font-mono text-sm hover:bg-red-500/20 transition-all font-bold"
          >
            <Square size={16} fill="currentColor" />
            END NOW
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <button
        onClick={() => startSession(60, 'Manual Focus Block')}
        className="group relative flex items-center justify-center gap-3 px-8 py-4 bg-teal-500/10 border border-teal-500/30 text-teal-400 rounded-lg font-mono font-bold text-lg hover:bg-teal-500/20 hover:border-teal-400 transition-all overflow-hidden"
      >
        <div className="absolute inset-0 w-full h-full bg-teal-500/5 group-hover:bg-transparent transition-colors"></div>
        <Play size={20} fill="currentColor" className="relative z-10" />
        <span className="relative z-10 tracking-widest">ENABLE GUARDIAN</span>
      </button>
      <div className="mt-4 flex items-center gap-4 text-sm font-mono text-tertiaryText">
        <button onClick={() => startSession(30, 'Quick Push')} className="hover:text-teal-400 transition-colors">30m</button>
        <button onClick={() => startSession(60, 'Deep Work')} className="hover:text-teal-400 transition-colors">1h</button>
        <button onClick={() => startSession(120, 'Marathon')} className="hover:text-teal-400 transition-colors">2h</button>
        <span className="text-hover">|</span>
        <div className="flex items-center gap-1">
          <Clock size={12} className="text-tertiaryText" />
          <input
            type="number"
            min="1"
            max="480"
            placeholder="min"
            value={customMinutes}
            onChange={e => setCustomMinutes(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCustomStart()}
            className="w-14 bg-transparent border-b border-hover text-center text-tertiaryText font-mono text-xs focus:outline-none focus:border-teal-500 transition-colors placeholder-tertiaryText/50"
          />
          {customMinutes && (
            <button onClick={handleCustomStart} className="text-teal-400 hover:text-teal-300 transition-colors text-xs font-bold">GO</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionControls;
