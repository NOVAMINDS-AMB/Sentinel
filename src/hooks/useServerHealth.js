import { useState, useEffect, useRef } from 'react';

const SERVER = 'http://localhost:3001';
const POLL_MS = 30000;

export function useServerHealth() {
  const [online, setOnline] = useState(true); // optimistic start
  const timerRef = useRef(null);

  const check = () => {
    fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(4000) })
      .then(r => setOnline(r.ok))
      .catch(() => setOnline(false));
  };

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  return online;
}
