import React, { useState, useRef } from 'react';
import Badge from './Badge';
import { ThumbsUp, ThumbsDown, Star, Ban, CheckCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFocus } from '../../context/FocusContext';

const SERVER = 'http://localhost:3001';

const InterruptCard = ({ interrupt, onReview }) => {
  const { user } = useAuth();
  const { bumpMlRefresh } = useFocus();
  const isCritical = interrupt.score >= 9;
  const [feedbackGiven, setFeedbackGiven] = useState(null);
  const [feedbackFlash, setFeedbackFlash] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shownAtRef = useRef(Date.now());

  if (dismissed) return null;

  const sendFeedback = async (rating) => {
    setFeedbackGiven(rating);
    setFeedbackFlash(true);
    setTimeout(() => setFeedbackFlash(false), 1200);
    const responseTimeSecs = Math.round((Date.now() - shownAtRef.current) / 1000);
    try {
      await fetch(`${SERVER}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          notification_id: interrupt.id,
          rating,
          response_time_seconds: responseTimeSecs
        })
      });
      bumpMlRefresh();
    } catch (e) {
      console.error('Feedback error:', e);
    }
  };

  return (
    <div className={`animate-slide-in relative bg-panel border-l-4 rounded-r p-4 shadow-lg flex flex-col gap-3 transition-colors hover:bg-hover
      ${isCritical ? 'border-critical' : 'border-high'}`}>

      {isCritical && (
        <div className="absolute inset-0 bg-critical/5 animate-pulse rounded-r pointer-events-none" />
      )}

      <div className="flex justify-between items-start relative z-10">
        <div className="flex items-center gap-2">
          <Badge tier={isCritical ? 'critical' : 'high'} label={interrupt.source} />
          <span className={`font-mono font-bold text-sm ${isCritical ? 'text-critical' : 'text-high'}`}>
            {interrupt.score.toFixed(1)}/10
          </span>
        </div>
        <span className="text-xs text-tertiaryText">{interrupt.timeAgo}</span>
      </div>

      <div className="relative z-10">
        <h3 className="text-base font-mono font-semibold text-primaryText mb-1">{interrupt.title}</h3>
        <p className="text-secondaryText text-sm line-clamp-2">{interrupt.excerpt}</p>
      </div>

      <div className="flex justify-between items-center mt-1 relative z-10">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full bg-hover flex items-center justify-center text-tertiaryText text-[10px]">
            {interrupt.source === 'email' ? '✉' : interrupt.source === 'whatsapp' ? '💬' : interrupt.source === 'linkedin' ? 'in' : '●'}
          </div>
          <span className="text-secondaryText font-mono font-medium">{interrupt.sender}</span>
        </div>

        <div className="flex gap-2">
          <button onClick={() => { sendFeedback('correct'); setDismissed(true); }}
            className="px-3 py-1.5 text-xs font-mono font-bold bg-hover text-primaryText hover:bg-white/10 rounded transition-colors">
            DISMISS
          </button>
          <button onClick={() => { sendFeedback('correct'); onReview && onReview(interrupt); }}
            className={`px-3 py-1.5 text-xs font-mono font-bold rounded transition-colors
              ${isCritical ? 'bg-critical/20 text-critical hover:bg-critical/30' : 'bg-high/20 text-high hover:bg-high/30'}`}>
            REVIEW
          </button>
        </div>
      </div>

      {/* ML Feedback strip */}
      <div className={`relative z-10 border-t border-hover/50 pt-2 flex items-center justify-between transition-colors duration-300 ${feedbackFlash ? 'bg-success/10 rounded' : ''}`}>
        <span className="text-[10px] text-tertiaryText font-mono uppercase tracking-wider flex items-center gap-1">
          {feedbackFlash ? <><CheckCircle size={10} className="text-success" /> Logged</> : 'Was this score correct?'}
        </span>
        <div className="flex gap-1">
          <FeedbackBtn
            icon={<ThumbsUp size={11} />}
            label="Correct"
            active={feedbackGiven === 'correct'}
            onClick={() => sendFeedback('correct')}
            color="text-success"
          />
          <FeedbackBtn
            icon={<ThumbsDown size={11} />}
            label="Too high"
            active={feedbackGiven === 'too_high'}
            onClick={() => sendFeedback('too_high')}
            color="text-medium"
          />
          <FeedbackBtn
            icon={<ThumbsDown size={11} className="rotate-180" />}
            label="Too low"
            active={feedbackGiven === 'too_low'}
            onClick={() => sendFeedback('too_low')}
            color="text-high"
          />
          <FeedbackBtn
            icon={<Star size={11} />}
            label="VIP"
            active={feedbackGiven === 'vip_add'}
            onClick={() => sendFeedback('vip_add')}
            color="text-teal-400"
          />
          <FeedbackBtn
            icon={<Ban size={11} />}
            label="Block"
            active={feedbackGiven === 'block_sender'}
            onClick={() => sendFeedback('block_sender')}
            color="text-critical"
          />
        </div>
      </div>
    </div>
  );
};

const FeedbackBtn = ({ icon, label, active, onClick, color }) => (
  <button
    onClick={onClick}
    title={label}
    className={`p-1.5 rounded transition-colors ${active ? `bg-hover ${color}` : 'text-tertiaryText hover:text-primaryText hover:bg-hover'}`}
  >
    {icon}
  </button>
);

export default InterruptCard;
