import React from 'react';
import { useFocus } from '../../context/FocusContext';
import InterruptCard from '../ui/InterruptCard';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

const InterruptList = () => {
  const { interrupts, isFocusGuardianActive } = useFocus();

  if (!interrupts || interrupts.length === 0) {
    if (!isFocusGuardianActive) return null;
    return (
      <div className="flex items-center gap-3 p-4 rounded border border-success/20 bg-success/5">
        <ShieldCheck className="text-success shrink-0" size={18} />
        <p className="font-mono text-sm text-success">No interrupts. Focus is protected.</p>
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4 border-b border-critical/30 pb-2">
        <AlertTriangle className="text-critical animate-pulse" size={20} />
        <h2 className="text-critical font-mono font-bold tracking-widest text-sm uppercase">Active Interrupts ({interrupts.length})</h2>
      </div>
      
      <div className="space-y-4">
        {interrupts.map(item => (
          <InterruptCard key={item.id} interrupt={item} />
        ))}
      </div>
    </section>
  );
};

export default InterruptList;
