import React from 'react';
import { Mail, MessageCircle, Linkedin, GitBranch, Bell } from 'lucide-react';

const ICONS = {
  email:     { Icon: Mail,          color: 'text-red-400',   bg: 'bg-red-400/10' },
  gmail:     { Icon: Mail,          color: 'text-red-400',   bg: 'bg-red-400/10' },
  whatsapp:  { Icon: MessageCircle, color: 'text-green-400', bg: 'bg-green-400/10' },
  linkedin:  { Icon: Linkedin,      color: 'text-blue-400',  bg: 'bg-blue-400/10' },
  github:    { Icon: GitBranch,     color: 'text-purple-400',bg: 'bg-purple-400/10' },
};

const SourceIcon = ({ source, size = 14, className = '' }) => {
  const key = (source || '').toLowerCase();
  const { Icon, color, bg } = ICONS[key] || { Icon: Bell, color: 'text-tertiaryText', bg: 'bg-hover' };
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded ${bg} flex-shrink-0 ${className}`}>
      <Icon size={size} className={color} />
    </span>
  );
};

export default SourceIcon;
