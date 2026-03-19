import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const LoginScreen = () => {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    if (mode === 'reset') {
      const { error } = await resetPassword(email);
      if (error) setError(error.message);
      else setMessage('Password reset email sent — check your inbox.');
    } else if (mode === 'signup') {
      const { error } = await signUp(email, password);
      if (error) setError(error.message);
      else setMessage('Account created — check your email to confirm, then log in.');
    } else {
      const { error } = await signIn(email, password);
      if (error) setError(error.message);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-base flex flex-col items-center justify-center p-6 font-sans">
      <div className="mb-8 flex flex-col items-center gap-3">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-500">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <h1 className="text-2xl font-mono font-bold text-primaryText tracking-widest">SENTINEL</h1>
        <p className="text-secondaryText text-sm font-mono">Focus Guardian System</p>
      </div>

      <div className="w-full max-w-sm bg-panel border border-hover rounded-lg p-8">
        <h2 className="text-sm font-mono font-bold tracking-widest text-tertiaryText uppercase mb-6">
          {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Reset Password'}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-mono text-secondaryText mb-1.5 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-base border border-hover rounded px-3 py-2 text-primaryText font-mono text-sm focus:outline-none focus:border-teal-500 transition-colors"
              placeholder="you@example.com"
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="block text-xs font-mono text-secondaryText mb-1.5 uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-base border border-hover rounded px-3 py-2 text-primaryText font-mono text-sm focus:outline-none focus:border-teal-500 transition-colors"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <p className="text-xs font-mono text-critical bg-critical/10 border border-critical/20 rounded p-2">
              {error}
            </p>
          )}

          {message && (
            <p className="text-xs font-mono text-success bg-success/10 border border-success/20 rounded p-2">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full py-2.5 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded font-mono font-bold text-sm tracking-widest hover:bg-teal-500/30 transition-all disabled:opacity-50"
          >
            {loading ? 'PROCESSING...' : mode === 'login' ? 'ENTER SYSTEM' : mode === 'signup' ? 'CREATE ACCOUNT' : 'SEND RESET EMAIL'}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center gap-2">
          {mode === 'login' && (
            <>
              <button
                onClick={() => { setMode('signup'); setError(''); setMessage(''); }}
                className="text-xs font-mono text-tertiaryText hover:text-teal-400 transition-colors"
              >
                Don't have an account? Sign up
              </button>
              <button
                onClick={() => { setMode('reset'); setError(''); setMessage(''); }}
                className="text-xs font-mono text-tertiaryText hover:text-secondaryText transition-colors"
              >
                Forgot password?
              </button>
            </>
          )}
          {(mode === 'signup' || mode === 'reset') && (
            <button
              onClick={() => { setMode('login'); setError(''); setMessage(''); }}
              className="text-xs font-mono text-tertiaryText hover:text-teal-400 transition-colors"
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
