/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, AlertTriangle, ShieldCheck, Zap } from 'lucide-react';
import { MascotAvatar } from './Mascots.js';

interface ErrorScreenProps {
  code: 404 | 403 | 500;
  onGoBack: () => void;
}

export default function ErrorScreen({ code, onGoBack }: ErrorScreenProps) {
  const meta = {
    404: {
      title: 'Coordinate Not Found',
      text: 'That URL has withered away like an unwatered leek. Coordinate not found.',
      mascot: 'bugku',
      color: '#EF4444',
      badge: 'ERROR_404',
      icon: <AlertTriangle className="w-5 h-5 text-red-500 animate-bounce" />,
    },
    403: {
      title: 'Access Shield Raised',
      text: 'Seeku has raised the security shield. You do not have clearance characters to access this vault segment.',
      mascot: 'seeku',
      color: '#3B82F6',
      badge: 'FORBIDDEN_403',
      icon: <ShieldCheck className="w-5 h-5 text-blue-500 animate-pulse" />,
    },
    500: {
      title: 'Reactor Core Overload',
      text: 'Vocaloid cyber core overload! The reactor dropped a key. Report down to Logku immediately.',
      mascot: 'bugku',
      color: '#FF007F',
      badge: 'SERVER_FAULT_500',
      icon: <Zap className="w-5 h-5 text-pink-500 animate-bounce" />,
    },
  }[code] || {
    title: 'Unknown Exception',
    text: 'A dimensional rift occurred in the leek field.',
    mascot: 'bugku',
    color: '#EF4444',
    badge: 'ERROR_UNKNOWN',
    icon: <AlertTriangle className="w-5 h-5 text-red-500" />,
  };

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <motion.div
        className="bg-[#0A0E14] border-4 p-8 text-center space-y-6 relative overflow-hidden"
        style={{ borderColor: meta.color, boxShadow: `8px 8px 0px ${code === 404 ? '#00F2FF' : '#FF007F'}` }}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
      >
        {/* Cyber Warning Badge */}
        <div
          className="absolute top-0 right-0 text-white px-3 py-1 font-mono font-black text-[10px] uppercase tracking-wider"
          style={{ backgroundColor: meta.color }}
        >
          {meta.badge}
        </div>

        {/* Mascot Avatar */}
        <div className="flex justify-center pt-2">
          <MascotAvatar id={meta.mascot} size="lg" />
        </div>

        <div className="space-y-4">
          <h2 className="font-display font-black text-2xl text-white uppercase italic tracking-tighter flex items-center justify-center gap-1.5">
            {meta.icon}
            <span>{meta.title}</span>
          </h2>
          
          <div className="py-4 px-5 bg-[#1A1F26] border-2 border-gray-800 rounded-none leading-relaxed text-zinc-300 font-mono text-[11px] uppercase">
            ⚠️ MSG: "{meta.text}"
          </div>
        </div>

        <button
          onClick={onGoBack}
          className="px-6 py-3 border-2 text-white font-mono text-xs uppercase font-extrabold skew-x-[-10deg] cursor-pointer hover:text-[#0A0E14] transition-all inline-flex items-center gap-2 bg-black"
          style={{
            borderColor: meta.color,
            '--hover-bg': meta.color,
          } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = meta.color;
            e.currentTarget.style.color = '#0A0E14';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'black';
            e.currentTarget.style.color = 'white';
          }}
        >
          <span className="inline-block skew-x-[10deg] flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            <span>Go Back to Home Vault</span>
          </span>
        </button>
      </motion.div>
    </div>
  );
}
