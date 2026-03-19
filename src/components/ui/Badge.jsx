import React from 'react';

const Badge = ({ tier, label }) => {
  const getColors = (tier) => {
    switch (tier) {
      case 'critical':
        return 'bg-critical/10 text-critical border border-critical/30';
      case 'high':
        return 'bg-high/10 text-high border border-high/30';
      case 'medium':
        return 'bg-medium/10 text-medium border border-medium/30';
      case 'low':
        return 'bg-low/10 text-low border border-low/30';
      case 'success':
        return 'bg-success/10 text-success border border-success/30';
      case 'info':
        return 'bg-info/10 text-info border border-info/30';
      default:
        return 'bg-hover text-secondaryText border border-transparent';
    }
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${getColors(tier)}`}>
      {label}
    </span>
  );
};

export default Badge;
