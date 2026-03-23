import React, { useState, useEffect } from 'react';
import { Shield, Clock, Archive, Settings, Activity, LogOut, Plug, Brain } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFocus } from '../../context/FocusContext';
import { useToast } from '../../context/ToastContext';
import IntegrationSetup from '../integrations/IntegrationSetup';

const SERVER = 'http://localhost:3001';

const Sidebar = ({ activeView = 'overview', onNavChange }) => {
  const { user, signOut } = useAuth();
  const { mlRefreshTick } = useFocus();
  const { addToast } = useToast();
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [mlStats, setMlStats] = useState(null);

  useEffect(() => {
    if (!user) return;
    fetch(`${SERVER}/ml/profile/${user.id}`)
      .then(r => r.json())
      .then(data => setMlStats(data))
      .catch(() => {});
  }, [user, mlRefreshTick]);

  // Auto-open integrations modal after OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const integration = params.get('integration');
    const status = params.get('status');
    if (integration && status) {
      window.history.replaceState({}, '', window.location.pathname);
      if (status === 'connected') {
        addToast(`${integration.charAt(0).toUpperCase() + integration.slice(1)} connected successfully`, 'success');
        setShowIntegrations(true);
      } else if (status === 'error') {
        const msg = params.get('msg') || 'Connection failed';
        addToast(`Integration error: ${msg}`, 'error');
      }
    }
  }, []);

  const accuracy = mlStats?.accuracy_pct;
  const interactions = mlStats?.profile?.total_interactions || 0;
  const phase = interactions < 15 ? 'Cold Start' : interactions < 50 ? 'Learning' : 'Calibrated';
  const phaseColor = interactions < 15 ? 'text-medium' : interactions < 50 ? 'text-teal-400' : 'text-success';

  return (
    <>
      <div className="h-full flex flex-col p-6">
        <div className="flex items-center gap-3 mb-10">
          <Shield className="text-teal-500" size={28} />
          <div>
            <h1 className="font-mono font-bold text-xl tracking-wider text-primaryText">SENTINEL</h1>
            <p className="text-[10px] text-tertiaryText tracking-widest uppercase">Context-Aware Triage</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          <NavItem icon={<Activity size={18} />} label="Active Overview" active={activeView === 'overview'} onClick={() => onNavChange('overview')} />
          <NavItem icon={<Clock size={18} />} label="Focus Sessions" active={activeView === 'sessions'} onClick={() => onNavChange('sessions')} />
          <NavItem icon={<Archive size={18} />} label="Archive" active={activeView === 'archive'} onClick={() => onNavChange('archive')} />
          <NavItem icon={<Plug size={18} />} label="Integrations" active={false} onClick={() => setShowIntegrations(true)} />
          <NavItem icon={<Settings size={18} />} label="Rules & AI" active={activeView === 'rules'} onClick={() => onNavChange('rules')} />
        </nav>

        <div className="mt-auto space-y-4 border-t border-hover pt-5">
          {/* ML Status */}
          <div className="bg-base rounded border border-hover p-3 text-xs font-mono space-y-2">
            <div className="flex items-center gap-1.5 text-tertiaryText mb-2">
              <Brain size={12} />
              <span className="uppercase tracking-wider">AI Learning</span>
            </div>
            <div className="flex justify-between">
              <span className="text-secondaryText">Phase</span>
              <span className={phaseColor}>{phase}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-secondaryText">Interactions</span>
              <span className="text-primaryText">{interactions}</span>
            </div>
            {accuracy !== null && (
              <div className="flex justify-between">
                <span className="text-secondaryText">Accuracy</span>
                <span className={accuracy >= 75 ? 'text-success' : 'text-medium'}>{accuracy}%</span>
              </div>
            )}
            {interactions < 15 && (
              <p className="text-tertiaryText text-[10px] pt-1 border-t border-hover">
                {15 - interactions} more interactions needed to begin personalisation
              </p>
            )}
          </div>

          {/* System status */}
          <div className="bg-panel rounded p-3 text-xs font-mono text-secondaryText">
            <div className="text-[10px] text-tertiaryText mb-2 uppercase tracking-wider">System</div>
            <div className="flex justify-between"><span>Core</span><span className="text-teal-500">ONLINE</span></div>
            <div className="flex justify-between mt-1"><span>Sentinel AI Agent</span><span className="text-teal-500">READY</span></div>
          </div>

          {user && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-tertiaryText truncate max-w-[130px]">{user.email}</span>
              <button onClick={signOut} className="flex items-center gap-1 text-[10px] font-mono text-tertiaryText hover:text-critical transition-colors" title="Sign out">
                <LogOut size={12} /> OUT
              </button>
            </div>
          )}
        </div>
      </div>

      {showIntegrations && <IntegrationSetup onClose={() => setShowIntegrations(false)} />}
    </>
  );
};

const NavItem = ({ icon, label, active, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded font-mono text-sm transition-colors ${active ? 'bg-hover text-primaryText border-l-2 border-teal-500' : 'text-secondaryText hover:bg-hover hover:text-primaryText border-l-2 border-transparent'}`}>
    {icon}{label}
  </button>
);

export default Sidebar;
