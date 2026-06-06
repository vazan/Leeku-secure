import React from 'react';
import { motion } from 'motion/react';
import leekuMascotImg from '../leeku_mascot.png';

export interface MascotInfo {
  id: string;
  name: string;
  role: string;
  personality: string;
  color: string;
  borderColor: string;
  bgColor: string;
}

export const MASCOTS: Record<string, MascotInfo> = {
  leeku: {
    id: 'leeku',
    name: 'Leeku',
    role: 'Vault Guardian',
    personality: 'Cheerful, Chaotic, Friendly',
    color: '#00F2FF',
    borderColor: 'border-[#00F2FF]',
    bgColor: 'bg-[#00F2FF]/10',
  },
  seeku: {
    id: 'seeku',
    name: 'Seeku',
    role: 'Security Specialist',
    personality: 'Serious, Professional, Slightly paranoid',
    color: '#3B82F6',
    borderColor: 'border-[#3B82F6]',
    bgColor: 'bg-[#3B82F6]/10',
  },
  veeku: {
    id: 'veeku',
    name: 'Veeku',
    role: 'Vault Keeper',
    personality: 'Calm, Reliable',
    color: '#10B981',
    borderColor: 'border-[#10B981]',
    bgColor: 'bg-[#10B981]/10',
  },
  queueku: {
    id: 'queueku',
    name: 'Queueku',
    role: 'Queue Processor',
    personality: 'Hyperactive',
    color: '#FBBF24',
    borderColor: 'border-[#FBBF24]',
    bgColor: 'bg-[#FBBF24]/10',
  },
  logku: {
    id: 'logku',
    name: 'Logku',
    role: 'Admin Monitor',
    personality: 'Knows everything, Observant',
    color: '#8B5CF6',
    borderColor: 'border-[#8B5CF6]',
    bgColor: 'bg-[#8B5CF6]/10',
  },
  quoteku: {
    id: 'quoteku',
    name: 'Quoteku',
    role: 'Quota Guard',
    personality: 'Constantly worried about storage limits',
    color: '#F97316',
    borderColor: 'border-[#F97316]',
    bgColor: 'bg-[#F97316]/10',
  },
  linku: {
    id: 'linku',
    name: 'Linku',
    role: 'Share Manager',
    personality: 'Social and outgoing',
    color: '#EC4899',
    borderColor: 'border-[#EC4899]',
    bgColor: 'bg-[#EC4899]/10',
  },
  bugku: {
    id: 'bugku',
    name: 'Bugku',
    role: 'Rare Bug',
    personality: 'Glitchy, Causes trouble',
    color: '#EF4444',
    borderColor: 'border-[#EF4444]',
    bgColor: 'bg-[#EF4444]/10',
  },
  memeku: {
    id: 'memeku',
    name: 'Memeku',
    role: 'Legendary Easter Egg',
    personality: 'Extremely rare, Deal with it style',
    color: '#FF007F',
    borderColor: 'border-[#FF007F]',
    bgColor: 'bg-[#FF007F]/10',
  },
};

interface MascotAvatarProps {
  id: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  animate?: boolean;
}

export function MascotAvatar({ id, size = 'md', className = '', animate = true }: MascotAvatarProps) {
  const sizeMap = {
    xs: 'w-8 h-8',
    sm: 'w-12 h-12',
    md: 'w-20 h-20',
    lg: 'w-32 h-32',
    xl: 'w-48 h-48',
  };

  const getMascotSvg = () => {
    switch (id) {
      case 'leeku':
        return (
          <img 
            src={leekuMascotImg} 
            alt="Leeku" 
            className="w-full h-full object-cover" 
            referrerPolicy="no-referrer"
          />
        );
      case 'seeku':
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Security visor specialist */}
            <circle cx="50" cy="50" r="45" fill="#0A111F" stroke="#3B82F6" strokeWidth="3" />
            {/* Grid pattern background */}
            <line x1="30" y1="10" x2="30" y2="90" stroke="#3B82F6" strokeWidth="0.5" strokeDasharray="2 2" />
            <line x1="70" y1="10" x2="70" y2="90" stroke="#3B82F6" strokeWidth="0.5" strokeDasharray="2 2" />
            {/* Cool security glasses */}
            <rect x="18" y="38" width="64" height="15" fill="#FF5F00" opacity="0.9" rx="3" stroke="#FFFFFF" strokeWidth="1.5" />
            {/* Visor shine */}
            <path d="M 22 41 L 45 41" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
            {/* Serious mouth */}
            <line x1="42" y1="65" x2="58" y2="65" stroke="#3B82F6" strokeWidth="3px" strokeLinecap="round" />
            {/* Scan scope pointer */}
            <circle cx="50" cy="50" r="35" fill="none" stroke="#3B82F6" strokeWidth="1" strokeDasharray="4 4" />
          </svg>
        );
      case 'veeku':
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Vault keeper */}
            <circle cx="50" cy="50" r="45" fill="#0A111F" stroke="#10B981" strokeWidth="3" />
            {/* Calm sleepy eyes */}
            <path d="M 30 46 L 42 46" stroke="#10B981" strokeWidth="3.5" strokeLinecap="round" />
            <path d="M 58 46 L 70 46" stroke="#10B981" strokeWidth="3.5" strokeLinecap="round" />
            {/* Reliable serene smile */}
            <path d="M 44 60 Q 50 64 56 60" fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" />
            {/* Shield / Vault element */}
            <path d="M 42 18 L 58 18 L 65 30 L 50 35 L 35 30 Z" fill="#10B981" opacity="0.3" stroke="#10B981" strokeWidth="1.5" />
            {/* Padlock on ear */}
            <rect x="70" y="55" width="12" height="10" fill="#10B981" rx="1" />
            <path d="M 73 55 L 73 50 Q 76 46 79 50 L 79 55" fill="none" stroke="#10B981" strokeWidth="1.5" />
          </svg>
        );
      case 'queueku':
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Hyperactive dynamic gear */}
            <circle cx="50" cy="50" r="45" fill="#0A111F" stroke="#FBBF24" strokeWidth="3" />
            {/* Speed spikes */}
            <path d="M 10 50 L 22 47 L 22 53 Z M 90 50 L 78 47 L 78 53 Z" fill="#FBBF24" />
            <path d="M 50 10 L 47 22 L 53 22 Z M 50 90 L 47 78 L 53 78 Z" fill="#FBBF24" />
            {/* Big spinny eyes */}
            <circle cx="34" cy="45" r="9" h-9 fill="none" stroke="#FBBF24" strokeWidth="2.5" />
            <circle cx="34" cy="45" r="3" fill="#FBBF24" />
            <circle cx="66" cy="45" r="9" h-9 fill="none" stroke="#FBBF24" strokeWidth="2.5" />
            <circle cx="66" cy="45" r="3" fill="#FBBF24" />
            {/* Expressive chaotic mouth */}
            <path d="M 40 64 Q 50 78 60 64" fill="none" stroke="#FBBF24" strokeWidth="3.5" strokeLinecap="round" />
            {/* Lightning bolt */}
            <path d="M 48 30 L 56 30 L 46 42 L 54 42 L 44 56" fill="none" stroke="#FF007F" strokeWidth="2" />
          </svg>
        );
      case 'logku':
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Monitors & logs wisdom */}
            <circle cx="50" cy="50" r="45" fill="#0A111F" stroke="#8B5CF6" strokeWidth="3" />
            {/* Binary background */}
            <text x="15" y="30" fill="#8B5CF6" fontSize="8" fontFamily="monospace" opacity="0.4">10</text>
            <text x="75" y="30" fill="#8B5CF6" fontSize="8" fontFamily="monospace" opacity="0.4">01</text>
            <text x="15" y="80" fill="#8B5CF6" fontSize="8" fontFamily="monospace" opacity="0.4">11</text>
            {/* Cyber lens eye */}
            <circle cx="50" cy="45" r="14" fill="none" stroke="#8B5CF6" strokeWidth="3" />
            <circle cx="50" cy="45" r="6" fill="#8B5CF6" />
            {/* Code bracket mouth */}
            <path d="M 40 70 L 45 66 L 40 62" fill="none" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 60 70 L 55 66 L 60 62" fill="none" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        );
      case 'quoteku':
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Worried capacity keeper */}
            <circle cx="50" cy="50" r="45" fill="#0A111F" stroke="#F97316" strokeWidth="3" />
            {/* Worried sweat drops */}
            <circle cx="18" cy="35" r="2" fill="#F97316" />
            <path d="M 18 35 L 20 44" stroke="#F97316" strokeWidth="1.5" />
            {/* Worried slant eyebrows */}
            <path d="M 24 38 L 38 42" stroke="#F97316" strokeWidth="3.5" strokeLinecap="round" />
            <path d="M 76 38 L 62 42" stroke="#F97316" strokeWidth="3.5" strokeLinecap="round" />
            {/* Scared circle eyes */}
            <circle cx="33" cy="50" r="6" fill="none" stroke="#F97316" strokeWidth="2.5" />
            <circle cx="67" cy="50" r="6" fill="none" stroke="#F97316" strokeWidth="2.5" />
            {/* Squiggly mouth */}
            <path d="M 40 66 Q 45 61 50 66 Q 55 71 60 66" fill="none" stroke="#F97316" strokeWidth="3" strokeLinecap="round" />
          </svg>
        );
      case 'linku':
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Outgoing social connection */}
            <circle cx="50" cy="50" r="45" fill="#0A111F" stroke="#EC4899" strokeWidth="3" />
            {/* Playful wink eyes */}
            <path d="M 28 48 Q 35 40 40 48" fill="none" stroke="#EC4899" strokeWidth="3.5" strokeLinecap="round" />
            {/* Wink eye */}
            <path d="M 60 44 L 72 52" stroke="#EC4899" strokeWidth="3.5" strokeLinecap="round" />
            <path d="M 60 52 L 72 44" stroke="#EC4899" strokeWidth="3.5" strokeLinecap="round" />
            {/* Love blush cheeks */}
            <circle cx="24" cy="58" r="4.5" fill="#EC4899" opacity="0.6" />
            <circle cx="76" cy="58" r="4.5" fill="#EC4899" opacity="0.6" />
            {/* Heart symbol mouth or side badge */}
            <path d="M 44 56 Q 50 50 56 56 Q 50 66 44 56 Z" fill="#EC4899" />
          </svg>
        );
      case 'bugku':
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Glitch trouble bug */}
            <rect x="5" y="5" width="90" height="90" fill="#0A111F" stroke="#EF4444" strokeWidth="3" />
            {/* Bug antennas */}
            <line x1="30" y1="20" x2="15" y2="5" stroke="#EF4444" strokeWidth="3" />
            <line x1="70" y1="20" x2="85" y2="5" stroke="#EF4444" strokeWidth="3" />
            {/* Grid matrix glitch blocks */}
            <rect x="15" y="32" width="10" height="10" fill="#EF4444" opacity="0.3" />
            <rect x="75" y="55" width="12" height="6" fill="#EF4444" opacity="0.5" />
            {/* Glitch cross eyes */}
            <line x1="30" y1="40" x2="42" y2="52" stroke="#EF4444" strokeWidth="4" />
            <line x1="42" y1="40" x2="30" y2="52" stroke="#EF4444" strokeWidth="4" />
            <line x1="58" y1="40" x2="70" y2="52" stroke="#EF4444" strokeWidth="4" />
            <line x1="70" y1="40" x2="58" y2="52" stroke="#EF4444" strokeWidth="4" />
            {/* Angry pixel mouth */}
            <rect x="40" y="65" width="20" height="4" fill="#EF4444" />
          </svg>
        );
      case 'memeku':
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Golden deal-with-it sunglasses */}
            <circle cx="50" cy="50" r="45" fill="#0A111F" stroke="#FF007F" strokeWidth="3" />
            <polygon points="50,15 58,35 80,35 62,48 70,70 50,56 30,70 38,48 20,35 42,35" fill="#FFD700" stroke="#FF007F" strokeWidth="1" />
            {/* Cool glasses drops */}
            <rect x="23" y="38" width="54" height="12" fill="#000000" rx="1" stroke="#FFFFFF" strokeWidth="1.5" />
            <polygon points="26,38 34,38 29,48" fill="#000000" />
            <polygon points="66,38 74,38 69,48" fill="#000000" />
            {/* Sparkles */}
            <text x="12" y="30" fill="#FF007F" fontSize="12" fontWeight="bold">★</text>
            <text x="80" y="75" fill="#00F2FF" fontSize="12" fontWeight="bold">★</text>
            {/* smug smirk */}
            <path d="M 45 56 Q 52 50 56 56" fill="none" stroke="#FF007F" strokeWidth="3" strokeLinecap="round" />
          </svg>
        );
      default:
        return null;
    }
  };

  const animationProps = animate
    ? {
        animate: {
          y: id === 'queueku' ? [0, -6, 0] : [0, -3, 0],
          rotate: id === 'bugku' ? [0, 2, -2, 0] : [0, 0.5, -0.5, 0],
        },
        transition: {
          duration: id === 'queueku' ? 1.5 : 3.5,
          repeat: Infinity,
          ease: 'easeInOut',
        },
      }
    : {};

  return (
    <motion.div
      {...animationProps}
      className={`relative rounded-none overflow-hidden border-2 flex items-center justify-center p-1 bg-black ${MASCOTS[id]?.borderColor || 'border-gray-800'} ${sizeMap[size]} ${className}`}
    >
      {getMascotSvg()}
    </motion.div>
  );
}

interface MascotSpeechBubbleProps {
  mascotId: string;
  quote: string;
  size?: 'sm' | 'md';
  className?: string;
  arrowPosition?: 'top' | 'bottom' | 'left' | 'right';
}

export function MascotSpeechBubble({
  mascotId,
  quote,
  size = 'md',
  className = '',
  arrowPosition = 'bottom',
}: MascotSpeechBubbleProps) {
  const mascot = MASCOTS[mascotId] || MASCOTS.leeku;

  const arrowClasses = {
    top: 'top-[-8px] left-1/2 transform -translate-x-1/2 border-b-2 border-r-2 rotate-225',
    bottom: 'bottom-[-9px] left-1/2 transform -translate-x-1/2 border-r-2 border-b-2 rotate-45',
    left: 'left-[-8px] top-1/2 transform -translate-y-1/2 border-l-2 border-b-2 rotate-45',
    right: 'right-[-8px] top-1/2 transform -translate-y-1/2 border-r-2 border-t-2 rotate-45',
  };

  return (
    <div className={`relative ${mascot.bgColor} border-2 ${mascot.borderColor} p-4 font-mono ${className}`}>
      <div
        className={`absolute w-3 h-3 bg-black border-none ${arrowClasses[arrowPosition]} pointer-events-none`}
        style={{
          borderColor: mascot.color,
          backgroundColor: '#0A0E14',
          borderLeft: arrowPosition === 'left' || arrowPosition === 'top' ? `2px solid ${mascot.color}` : 'none',
          borderBottom: arrowPosition === 'bottom' || arrowPosition === 'left' ? `2px solid ${mascot.color}` : 'none',
          borderRight: arrowPosition === 'right' || arrowPosition === 'bottom' ? `2px solid ${mascot.color}` : 'none',
          borderTop: arrowPosition === 'top' || arrowPosition === 'right' ? `2px solid ${mascot.color}` : 'none',
        }}
      />
      <div className="flex items-center gap-2.5">
        <span className="text-[10px] uppercase font-black tracking-wider" style={{ color: mascot.color }}>
          {mascot.name} ({mascot.role}):
        </span>
      </div>
      <p className="text-xs italic text-gray-200 mt-1 leading-relaxed">
        "{quote}"
      </p>
    </div>
  );
}

export const QUOTEKU_MESSAGES = {
  warning80: "You are approaching the edge of the leek field.",
  warning95: "The vault is almost full.",
  warning100: "No more leeks can fit.",
};
