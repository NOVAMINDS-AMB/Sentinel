import React, { useState, useEffect } from 'react';
import { useFocus } from '../../context/FocusContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import InterruptList from '../focus/InterruptList';
import QueuedItems from '../focus/QueuedItems';
import SessionControls from '../focus/SessionControls';
import EndOfSessionSummary from '../focus/EndOfSessionSummary';
import EscalationOverlay from '../focus/EscalationOverlay';
import FocusSessionsView from '../views/FocusSessionsView';
import ArchiveView from '../views/ArchiveView';
import RulesView from '../views/RulesView';
import ErrorBoundary from '../ui/ErrorBoundary';
import { Menu, X, FlaskConical } from 'lucide-react';

const SERVER = 'http://localhost:3001';

const DashboardShell = () => {
  const { showSummary, isFocusGuardianActive, startSession, endSession } = useFocus();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [activeView, setActiveView] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [testInjecting, setTestInjecting] = useState(false);

  // Rotating test payloads for realistic demo variety
  const TEST_PAYLOADS = [
    { source: 'email', notification_type: 'Production Alert', sender: 'alerts@company.com', title: 'Production Alert', body: 'URGENT: Service latency spike detected on prod. P95 > 2s.' },
    { source: 'whatsapp', notification_type: 'WhatsApp Message', sender: '+1234567890', title: 'WhatsApp from Team', body: 'Hey, client is asking for the status update. Can you jump on a call?' },
    { source: 'email', notification_type: 'Newsletter', sender: 'no-reply@newsletter.com', title: 'Weekly Digest', body: 'Your weekly roundup of industry news and updates.' },
    { source: 'linkedin', notification_type: 'LinkedIn Message', sender: 'recruiter@corp.com', title: 'New opportunity', body: 'Hi, I came across your profile and wanted to connect about a senior role.' },
    { source: 'email', notification_type: 'Meeting Invite', sender: 'boss@company.com', title: 'Urgent sync needed', body: 'Can we talk before the 3pm deadline? Client escalated the issue.' },
  ];

  const handleTestInject = async () => {
    if (testInjecting || !user) return;
    setTestInjecting(true);
    const payload = TEST_PAYLOADS[Math.floor(Math.random() * TEST_PAYLOADS.length)];
    try {
      const res = await fetch(`${SERVER}/test/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, ...payload })
      });
      if (res.ok) {
        const data = await res.json();
        const score = data.score != null ? ` (score ${data.score.toFixed(1)})` : '';
        addToast(`Test notification injected${score}`, 'success');
      } else {
        addToast('Test inject failed', 'error');
      }
    } catch (e) {
      addToast('Test inject failed — server unreachable', 'error');
    }
    setTimeout(() => setTestInjecting(false), 1500);
  };

  // Ctrl+Shift+F — toggle Focus Guardian (5.1.7)
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        if (isFocusGuardianActive) {
          endSession();
        } else {
          startSession(60, 'Deep Work');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFocusGuardianActive, startSession, endSession]);

  if (showSummary) {
    return <EndOfSessionSummary />;
  }

  const renderMain = () => {
    if (activeView === 'sessions') return <FocusSessionsView />;
    if (activeView === 'archive') return <ArchiveView />;
    if (activeView === 'rules') return <RulesView />;

    // Default: overview
    if (!isFocusGuardianActive) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <div className="mb-6 opacity-80">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-teal-500 mx-auto opacity-50"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          </div>
          <h1 className="text-2xl font-mono text-primaryText mb-2">Focus Guardian Offline</h1>
          <p className="text-secondaryText mb-8 max-w-md">Activate Focus Guardian to suppress low-priority noise and protect your deep work session.</p>
          <SessionControls />
        </div>
      );
    }

    return (
      <div className="max-w-4xl mx-auto space-y-8 fade-in">
        <ErrorBoundary fallback="Unable to load interrupts.">
          <InterruptList />
        </ErrorBoundary>
        <ErrorBoundary fallback="Unable to load queued items.">
          <QueuedItems />
        </ErrorBoundary>
        <div className="flex justify-end">
          <button
            onClick={handleTestInject}
            disabled={testInjecting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-panel border border-hover rounded text-xs font-mono text-tertiaryText hover:text-primaryText hover:border-teal-500/30 transition-colors disabled:opacity-40"
            title="Inject a test notification"
          >
            <FlaskConical size={12} />
            {testInjecting ? 'Injecting...' : 'Test Inject'}
          </button>
        </div>
      </div>
    );
  };

  const handleNavChange = (view) => {
    setActiveView(view);
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen w-full bg-base overflow-hidden text-primaryText font-sans">
      <EscalationOverlay />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed drawer on mobile, static column on desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-72 border-r border-hover bg-base transition-transform duration-200
        md:static md:w-1/5 md:translate-x-0 md:z-10
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Mobile close button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute top-4 right-4 text-tertiaryText hover:text-primaryText md:hidden"
        >
          <X size={18} />
        </button>
        <ErrorBoundary fallback="Unable to load sidebar.">
          <Sidebar activeView={activeView} onNavChange={handleNavChange} />
        </ErrorBoundary>
      </div>

      <div className="flex-1 flex flex-col relative w-full md:w-4/5 min-w-0">
        {/* Mobile hamburger */}
        <div className="flex items-center md:hidden px-4 py-3 border-b border-hover bg-base">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-secondaryText hover:text-primaryText transition-colors"
          >
            <Menu size={20} />
          </button>
          <span className="ml-3 font-mono font-bold text-sm tracking-wider text-primaryText">SENTINEL</span>
        </div>

        <StatusBar />

        <main className="flex-1 overflow-y-auto p-6 lg:p-10 hide-scrollbar pb-32">
          <ErrorBoundary fallback="Unable to load this view. Try navigating to another section.">
            {renderMain()}
          </ErrorBoundary>
        </main>

        {isFocusGuardianActive && activeView === 'overview' && (
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-hover bg-base/95 backdrop-blur z-20">
            <div className="max-w-4xl mx-auto flex justify-center">
              <SessionControls />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardShell;
