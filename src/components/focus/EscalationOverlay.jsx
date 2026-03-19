import React from 'react';
import { useFocus } from '../../context/FocusContext';
import { AlertOctagon, X, Eye } from 'lucide-react';
import Badge from '../ui/Badge';

const EscalationOverlay = () => {
  const { escalationQueue, acknowledgeEscalation } = useFocus();

  if (!escalationQueue || escalationQueue.length === 0) return null;

  // Show the highest-scoring escalation
  const item = escalationQueue[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="max-w-lg w-full mx-4 bg-panel border border-critical/50 rounded-lg shadow-[0_0_40px_rgba(239,68,68,0.3)] overflow-hidden animate-pulse-once">

        {/* Header */}
        <div className="bg-critical/10 border-b border-critical/30 px-6 py-4 flex items-center gap-3">
          <AlertOctagon className="text-critical shrink-0" size={24} />
          <div className="flex-1">
            <p className="text-critical font-mono font-bold tracking-widest text-sm uppercase">
              Critical — Unacknowledged 5+ Min
            </p>
            <p className="text-xs text-secondaryText font-mono mt-0.5">
              This notification requires your attention
            </p>
          </div>
          {escalationQueue.length > 1 && (
            <span className="text-xs font-mono text-tertiaryText">
              +{escalationQueue.length - 1} more
            </span>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-3">
          <div className="flex items-center gap-2">
            <Badge tier="critical" label={item.source} />
            <span className="font-mono text-critical font-bold text-sm">{item.score?.toFixed(1)}/10</span>
            <span className="text-tertiaryText text-xs font-mono ml-auto">{item.timeAgo}</span>
          </div>

          <h2 className="text-primaryText font-mono font-bold text-lg leading-snug">{item.title}</h2>

          {item.excerpt && (
            <p className="text-secondaryText text-sm italic line-clamp-3">"{item.excerpt}"</p>
          )}

          <p className="text-xs text-tertiaryText font-mono">
            From: <span className="text-secondaryText">{item.sender}</span>
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={() => acknowledgeEscalation(item.id)}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-hover text-secondaryText hover:text-primaryText hover:bg-white/10 rounded font-mono text-sm font-bold tracking-widest transition-colors"
          >
            <X size={16} /> DISMISS
          </button>
          <button
            onClick={() => acknowledgeEscalation(item.id)}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-critical/20 text-critical hover:bg-critical/30 rounded font-mono text-sm font-bold tracking-widest transition-colors border border-critical/30"
          >
            <Eye size={16} /> REVIEW & DISMISS
          </button>
        </div>
      </div>
    </div>
  );
};

export default EscalationOverlay;
