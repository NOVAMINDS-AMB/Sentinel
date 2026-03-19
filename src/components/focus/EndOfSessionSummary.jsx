import React, { useState, useEffect } from 'react';
import { useFocus } from '../../context/FocusContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ShieldCheck, CheckSquare, Edit3, X, XSquare, Send, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import Badge from '../ui/Badge';

const SERVER = 'http://localhost:3001';

const EndOfSessionSummary = () => {
  const { summaryData, closeSummary, currentProject } = useFocus();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [approvedAll, setApprovedAll] = useState(false);
  const [sentItems, setSentItems] = useState({});
  const [skippedItems, setSkippedItems] = useState({});
  const [editingItem, setEditingItem] = useState(null);
  const [editText, setEditText] = useState('');
  const [lowExpanded, setLowExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    if (!user) return;
    fetch(`${SERVER}/ml/suggestions/${user.id}`)
      .then(r => r.json())
      .then(data => { if (data.suggestions?.length) setSuggestions(data.suggestions); })
      .catch(() => {});
  }, [user]);

  const recordDraft = async (item, draftText) => {
    if (!user) return;
    try {
      await fetch(`${SERVER}/session/drafts/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          notification_id: item.id,
          draft_text: draftText,
          target_platform: item.source || 'email',
          tier: 2
        })
      });
    } catch (e) {
      // Non-fatal — UI already shows SENT state
    }
  };

  const handleSend = async (item) => {
    setSentItems(prev => ({ ...prev, [item.id]: true }));
    await recordDraft(item, item.suggestion);
    addToast('Reply logged successfully', 'success');
  };

  const handleSkip = (item) => {
    setSkippedItems(prev => ({ ...prev, [item.id]: true }));
    addToast('Item skipped', 'info');
  };

  const handleEditOpen = (item) => {
    setEditingItem(item.id);
    setEditText(item.suggestion);
  };

  const handleEditSend = async (item) => {
    setSentItems(prev => ({ ...prev, [item.id]: true }));
    setEditingItem(null);
    await recordDraft(item, editText);
    addToast('Edited reply logged successfully', 'success');
  };

  const handleApproveAll = async () => {
    const allSent = {};
    summaryData.mediumReview.forEach(item => { allSent[item.id] = true; });
    setSentItems(allSent);
    setApprovedAll(true);
    await Promise.all(summaryData.mediumReview.map(item => recordDraft(item, item.suggestion)));
    addToast(`${summaryData.mediumReview.length} replies logged`, 'success');
  };

  const focusLabel = summaryData.focusScore >= 9 ? 'Peak Focus'
    : summaryData.focusScore >= 8 ? 'Excellent Focus'
    : summaryData.focusScore >= 6 ? 'Good Focus'
    : summaryData.focusScore >= 4 ? 'Needs Improvement'
    : 'Getting Started';

  const pendingCount = summaryData.mediumReview?.filter(
    item => !sentItems[item.id] && !skippedItems[item.id]
  ).length || 0;

  return (
    <div className="min-h-screen bg-base text-primaryText font-sans p-6 md:p-10 hide-scrollbar overflow-y-auto w-full">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <header className="flex justify-between items-center mb-10 pb-6 border-b border-hover">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="text-success" size={28} />
              <h1 className="text-2xl font-mono font-bold tracking-wider text-success">SESSION COMPLETE</h1>
            </div>
            <p className="text-secondaryText font-mono">
              Focus logged for <span className="text-primaryText font-bold">{currentProject}</span>.
              {summaryData.duration && <span className="text-tertiaryText ml-2">Duration: {summaryData.duration}</span>}
            </p>
          </div>
          <div className="text-right flex flex-col items-end">
            <span className="text-xs text-tertiaryText font-mono uppercase tracking-widest mb-1">Focus Score</span>
            <span className="text-3xl font-mono font-bold text-white">
              {summaryData.focusScore}<span className="text-lg text-secondaryText">/10</span>
            </span>
            <span className="text-success text-xs font-mono">{focusLabel}</span>
          </div>
        </header>

        {/* Critical Handled */}
        {summaryData.handledCritical?.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-mono tracking-widest text-tertiaryText mb-4 uppercase">
              Critical Handled ({summaryData.handledCritical.length})
            </h2>
            <div className="bg-panel rounded border border-hover overflow-hidden">
              {summaryData.handledCritical.map(item => (
                <div key={item.id} className="p-4 border-b border-hover last:border-0 flex justify-between items-center bg-critical/5">
                  <div>
                    <h3 className="font-mono font-bold text-primaryText">{item.title}</h3>
                    <p className="text-sm text-secondaryText mt-1">Action taken: {item.response}</p>
                  </div>
                  <Badge tier="success" label="RESOLVED" />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Medium Priority */}
        {summaryData.mediumReview?.length > 0 && (
          <section className="mb-10">
            <div className="flex justify-between items-end mb-4">
              <h2 className="text-sm font-mono tracking-widest text-tertiaryText uppercase">
                Medium Priority — {pendingCount} pending
              </h2>
              {pendingCount > 0 && !approvedAll && (
                <button
                  onClick={handleApproveAll}
                  className="text-xs font-mono font-bold tracking-widest bg-medium/20 text-medium px-4 py-2 rounded hover:bg-medium/30 transition-colors flex items-center gap-2"
                >
                  <CheckSquare size={14} /> APPROVE ALL
                </button>
              )}
            </div>

            <div className="space-y-4">
              {summaryData.mediumReview.map(item => {
                const isSent = sentItems[item.id];
                const isSkipped = skippedItems[item.id];
                const isEditing = editingItem === item.id;

                return (
                  <div key={item.id} className={`bg-panel rounded border-l-2 border-medium p-5 shadow-sm relative overflow-hidden transition-opacity ${isSkipped ? 'opacity-40' : ''}`}>
                    {isSent && <div className="absolute inset-0 bg-success/10 z-0 pointer-events-none" />}

                    <div className="relative z-10 flex gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge tier="medium" label={item.source || 'message'} />
                          <span className="text-tertiaryText text-sm">{item.sender}</span>
                        </div>
                        <h3 className="font-bold text-primaryText mb-1">{item.title}</h3>
                        <p className="text-sm text-secondaryText mb-4 italic">"{item.excerpt}"</p>

                        <div className="bg-base border border-hover rounded p-3">
                          <div className="text-[10px] text-teal-500 font-mono tracking-wider mb-1">AI DRAFT SUGGESTION</div>
                          {isEditing ? (
                            <textarea
                              value={editText}
                              onChange={e => setEditText(e.target.value)}
                              className="w-full bg-transparent text-sm text-primaryText font-mono resize-none focus:outline-none min-h-[60px]"
                              autoFocus
                            />
                          ) : (
                            <p className="text-sm text-primaryText font-mono">
                              {isSent && editText ? editText : item.suggestion}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="w-32 flex flex-col gap-2 justify-center flex-shrink-0">
                        {isSent ? (
                          <div className="flex items-center justify-center h-full text-success font-mono font-bold text-sm gap-2">
                            <ShieldCheck size={18} /> SENT
                          </div>
                        ) : isSkipped ? (
                          <div className="flex items-center justify-center h-full text-tertiaryText font-mono text-sm gap-2">
                            <X size={16} /> SKIPPED
                          </div>
                        ) : isEditing ? (
                          <>
                            <button
                              onClick={() => handleEditSend(item)}
                              className="flex items-center justify-center gap-2 w-full py-2 bg-success/20 text-success hover:bg-success/30 rounded text-xs font-mono font-bold transition-colors"
                            >
                              <Send size={14} /> SEND
                            </button>
                            <button
                              onClick={() => setEditingItem(null)}
                              className="flex items-center justify-center gap-2 w-full py-2 bg-hover text-secondaryText hover:text-primaryText rounded text-xs font-mono transition-colors"
                            >
                              <X size={14} /> CANCEL
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleSend(item)}
                              className="flex items-center justify-center gap-2 w-full py-2 bg-success/20 text-success hover:bg-success/30 rounded text-xs font-mono font-bold transition-colors"
                            >
                              <Send size={14} /> SEND
                            </button>
                            <button
                              onClick={() => handleEditOpen(item)}
                              className="flex items-center justify-center gap-2 w-full py-2 bg-hover text-secondaryText hover:text-primaryText rounded text-xs font-mono transition-colors"
                            >
                              <Edit3 size={14} /> EDIT
                            </button>
                            <button
                              onClick={() => handleSkip(item)}
                              className="flex items-center justify-center gap-2 w-full py-2 text-tertiaryText hover:text-critical rounded text-xs font-mono transition-colors"
                            >
                              <XSquare size={14} /> SKIP
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Low Priority */}
        <section className="mb-12">
          <h2 className="text-sm font-mono tracking-widest text-tertiaryText mb-4 uppercase">
            Low Priority / Informational
          </h2>
          <div className="bg-panel rounded border border-hover overflow-hidden">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-low" />
                <span className="font-mono text-secondaryText">
                  {summaryData.lowCount} items auto-handled or filed as FYI.
                </span>
              </div>
              <button
                onClick={() => setLowExpanded(!lowExpanded)}
                className="flex items-center gap-1 text-xs font-mono text-teal-500 hover:text-teal-400 font-bold uppercase tracking-wider transition-colors"
              >
                {lowExpanded ? 'Collapse' : 'Expand Details'}
                {lowExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>
            {lowExpanded && (
              <div className="border-t border-hover p-4 space-y-2">
                {summaryData.lowCount > 0 ? (
                  <p className="text-xs font-mono text-tertiaryText">
                    {summaryData.lowCount} low-priority notifications were suppressed during your session.
                    Senders received an automated managed-absence reply. No action required.
                  </p>
                ) : (
                  <p className="text-xs font-mono text-tertiaryText">No low-priority items this session.</p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* AI Optimisation Suggestions */}
        {suggestions.length > 0 && (
          <section className="mb-12">
            <h2 className="text-sm font-mono tracking-widest text-tertiaryText mb-4 uppercase">
              AI Suggestions
            </h2>
            <div className="bg-panel rounded border border-hover overflow-hidden divide-y divide-hover">
              {suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-3 p-4">
                  <Lightbulb size={14} className="text-teal-500 shrink-0 mt-0.5" />
                  <p className="text-sm font-mono text-secondaryText">{s}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Return button */}
        <div className="flex justify-center border-t border-hover pt-8 pb-12">
          <button
            onClick={closeSummary}
            className="flex items-center gap-2 px-8 py-3 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded font-mono font-bold tracking-widest hover:bg-teal-500/30 transition-all shadow-[0_0_15px_rgba(20,184,166,0.15)]"
          >
            RETURN TO STANDARD MODE
          </button>
        </div>

      </div>
    </div>
  );
};

export default EndOfSessionSummary;
