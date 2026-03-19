import React from 'react';
import { useFocus } from '../../context/FocusContext';
import { Shield, ShieldAlert, WifiOff } from 'lucide-react';
import { useServerHealth } from '../../hooks/useServerHealth';

const StatusBar = () => {
  const { isFocusGuardianActive, sessionTimeRemaining, currentProject } = useFocus();
  const serverOnline = useServerHealth();

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  const offlineBanner = !serverOnline && (
    <div className="bg-critical/10 border-b border-critical/30 px-6 py-2 flex items-center gap-2 text-xs font-mono text-critical">
      <WifiOff size={12} className="shrink-0" />
      Server unreachable — scoring and integrations paused. Check that the backend is running on port 3001.
    </div>
  );

  if (!isFocusGuardianActive) {
    return (
      <>
        {offlineBanner}
        <header className="sticky top-0 z-20 bg-base/80 backdrop-blur border-b border-hover p-4 px-6 md:px-10 flex justify-between items-center transition-all duration-300">
          <div className="flex items-center gap-3 text-secondaryText">
            <ShieldAlert size={20} className="text-medium opacity-70" />
            <span className="font-mono text-sm tracking-wide">FOCUS GUARDIAN: <span className="text-medium ml-1">OFFLINE</span></span>
          </div>
          <div className="text-sm font-mono text-tertiaryText hidden sm:block">
            Auto-activation at next <span className="text-primaryText">Deep Work</span> block
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      {offlineBanner}
      <header className="sticky top-0 z-20 bg-[#0a1a24]/90 backdrop-blur-md border-b-2 border-teal-500 p-4 px-6 md:px-10 flex justify-between items-center shadow-[0_4px_30px_rgba(20,184,166,0.15)] transition-all duration-500">
      <div className="flex items-center gap-4 text-primaryText">
        <div className="relative">
          <Shield size={22} className="text-teal-400 relative z-10" />
          <div className="absolute inset-0 bg-teal-400 blur-md opacity-50 animate-pulse rounded-full"></div>
        </div>
        <span className="font-mono text-sm font-bold tracking-widest text-teal-400">
          FOCUS GUARDIAN: <span className="text-white ml-1">ON</span>
        </span>
      </div>

      <div className="flex items-center gap-6">
        <div className="hidden md:flex flex-col items-end border-r border-teal-800 pr-6">
          <span className="text-[10px] text-teal-600 font-mono uppercase tracking-widest">Context</span>
          <span className="text-sm font-mono text-teal-100">{currentProject}</span>
        </div>
        <div className="flex flex-col items-end w-32">
          <span className="text-[10px] text-teal-600 font-mono uppercase tracking-widest">Time Remaining</span>
          <span className="text-lg font-mono font-bold text-white tracking-widest">{formatTime(sessionTimeRemaining)}</span>
        </div>
      </div>
    </header>
    </>
  );
};

export default StatusBar;
