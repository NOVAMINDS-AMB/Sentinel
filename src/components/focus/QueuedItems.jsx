import React, { useState } from 'react';
import { useFocus } from '../../context/FocusContext';
import { Package, ChevronDown, ChevronUp, List, X } from 'lucide-react';
import Badge from '../ui/Badge';
import SourceIcon from '../ui/SourceIcon';

const QueuedItems = () => {
  const { queuedCounts, queuedItems } = useFocus();
  const [expanded, setExpanded] = useState(false);
  const [showDetailed, setShowDetailed] = useState(false);

  const total = queuedCounts.medium + queuedCounts.low;

  if (total === 0) return null;

  return (
    <>
      <section className="mt-8">
        <div className="flex items-center justify-between bg-panel border-l-2 border-medium rounded p-4 shadow">
          <div className="flex items-center gap-3">
            <Package className="text-medium" size={20} />
            <div>
              <h2 className="font-mono font-bold text-sm tracking-wide text-primaryText">QUEUED ITEMS ({total})</h2>
              <p className="text-xs text-tertiaryText font-mono">Will review at end of session</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex gap-2">
              <Badge tier="medium" label={`${queuedCounts.medium} Medium`} />
              <Badge tier="low" label={`${queuedCounts.low} Low`} />
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 hover:bg-hover rounded text-tertiaryText hover:text-primaryText"
            >
              {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-2 bg-panel/50 rounded p-4 border border-hover font-mono text-sm space-y-3">
            <div className="text-tertiaryText flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-medium"></span>
              {queuedCounts.medium} items await your review and response approval.
            </div>
            <div className="text-tertiaryText flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-low"></span>
              {queuedCounts.low} items auto-acknowledged or batched for FYI.
            </div>
            <div className="pt-2">
              <button
                onClick={() => setShowDetailed(true)}
                className="flex items-center gap-2 text-teal-500 hover:text-teal-400 text-xs tracking-wider uppercase font-bold transition-colors"
              >
                <List size={13} /> + View Detailed Queue
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Detailed Queue Modal */}
      {showDetailed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-panel border border-hover rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-hover flex-shrink-0">
              <div className="flex items-center gap-2">
                <Package className="text-medium" size={18} />
                <h3 className="font-mono font-bold text-primaryText tracking-wide">QUEUED NOTIFICATIONS</h3>
                <span className="text-xs text-tertiaryText font-mono">({total})</span>
              </div>
              <button
                onClick={() => setShowDetailed(false)}
                className="p-1.5 rounded hover:bg-hover text-tertiaryText hover:text-primaryText transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 hide-scrollbar p-4 space-y-2">
              {queuedItems.length === 0 ? (
                <p className="text-tertiaryText font-mono text-sm text-center py-8">
                  Queue details collected during active session.
                </p>
              ) : (
                queuedItems.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between bg-base rounded border border-hover px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <SourceIcon source={item.source} />
                      <Badge tier={item.tier} label={item.tier} />
                      <div className="min-w-0">
                        <p className="text-sm font-mono text-primaryText truncate">{item.title || 'Notification'}</p>
                        <p className="text-xs text-tertiaryText font-mono">{item.sender}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                      <span className="text-xs font-mono text-tertiaryText">{item.timeAgo}</span>
                      <span className={`text-xs font-mono font-bold ${item.tier === 'medium' ? 'text-medium' : 'text-low'}`}>
                        {item.score.toFixed(1)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-hover flex-shrink-0">
              <p className="text-[10px] text-tertiaryText font-mono text-center">
                All queued items will appear in the End-of-Session Summary for review.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default QueuedItems;
