import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FocusProvider } from './context/FocusContext';
import { ToastProvider } from './context/ToastContext';
import DashboardShell from './components/layout/DashboardShell';
import LoginScreen from './components/auth/LoginScreen';
import OnboardingModal from './components/onboarding/OnboardingModal';

const SERVER = 'http://localhost:3001';

const AppInner = () => {
  const { user, loading } = useAuth();
  const [onboardingDone, setOnboardingDone] = useState(null); // null = checking

  useEffect(() => {
    if (!user) { setOnboardingDone(null); return; }
    fetch(`${SERVER}/onboarding/${user.id}`)
      .then(r => r.json())
      .then(data => setOnboardingDone(data?.completed === true))
      .catch(() => setOnboardingDone(true)); // fail open
  }, [user]);

  if (loading || (user && onboardingDone === null)) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="font-mono text-teal-500 animate-pulse tracking-widest">INITIALIZING...</div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <FocusProvider>
      {!onboardingDone && (
        <OnboardingModal onComplete={() => setOnboardingDone(true)} />
      )}
      <DashboardShell />
    </FocusProvider>
  );
};

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
