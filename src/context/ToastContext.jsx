import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext();

export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

const ToastContainer = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          onClick={() => onRemove(toast.id)}
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded font-mono text-sm shadow-lg border cursor-pointer transition-all
            ${toast.type === 'success'
              ? 'bg-panel border-success/40 text-success'
              : toast.type === 'error'
              ? 'bg-panel border-critical/40 text-critical'
              : 'bg-panel border-teal-500/40 text-teal-400'
            }`}
        >
          <span className="text-xs">
            {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}
          </span>
          {toast.message}
        </div>
      ))}
    </div>
  );
};
