/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Shield, Upload, Sparkles, HardDrive, Key, Flame } from 'lucide-react';
import { Quota } from '../types.js';
import leekuMascot from '../leeku_mascot.png';
import { MascotAvatar } from './Mascots.js';

interface LandingPageProps {
  onGoToAuth: (mode: 'login' | 'register') => void;
  quotas: Quota[];
  onSetView: (view: string) => void;
}

const LEEKU_QUOTES = [
  "Your files are safer here than in your Downloads folder.",
  "We scanned your file. The leek approved.",
  "The file screamed during encryption, but it is safe now.",
  "Leeku says this file has acceptable vibes.",
  "No digital goblins located in this sector today!",
  "Please stop feeding the server suspiciously large archives.",
  "I blocked some malware with my giant combat leek today."
];

export default function LandingPage({ onGoToAuth, quotas, onSetView }: LandingPageProps) {
  const [mascotQuote, setMascotQuote] = useState(LEEKU_QUOTES[0]);

  // Rotate mascot quotes periodically for micro-interaction amusement
  useEffect(() => {
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * LEEKU_QUOTES.length);
      setMascotQuote(LEEKU_QUOTES[idx]);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(0)} TB`;
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(0)} GB`;
    return `${(bytes / 1048576).toFixed(0)} MB`;
  };

  return (
    <div className="max-w-6xl mx-auto px-4 mt-8 pb-16">
      {/* Hero Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center mb-16 relative">
        <motion.div 
          className="lg:col-span-7 space-y-6 z-10"
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-[#00F2FF]/10 border border-[#00F2FF] text-[#00F2FF] font-mono text-xs rounded-none">
            <Flame className="w-4 h-4 text-[#00FF00]" id="flame-icon" />
            <span className="font-bold uppercase tracking-wider">SECURE STORAGE + QUESTIONABLE ANIME ENERGY</span>
          </div>

          <h1 className="font-display text-4xl sm:text-6xl font-black italic tracking-tighter text-white leading-tight uppercase" id="hero-title">
            Upload. Encrypt.<br />
            Share. <span className="text-[#FF007F] block sm:inline">Praise the leek.</span>
          </h1>

          <p className="text-gray-300 max-w-lg text-lg leading-relaxed font-sans">
            Secure file hosting with chaotic leek energy. Files are scanned for digital goblins, encrypted in our server vaults, and guarded by <strong className="text-[#00F2FF] font-extrabold uppercase">Leeku</strong> herself.
          </p>

          <div className="flex flex-wrap gap-6 pt-4">
            <button
              onClick={() => onGoToAuth('register')}
              className="bg-[#FF007F] text-white px-8 py-4 font-black text-lg skew-x-[-12deg] shadow-[4px_4px_0px_#00F2FF] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all cursor-pointer font-display inline-flex items-center gap-2 uppercase tracking-wide"
              id="btn-get-started"
            >
              <span className="inline-block skew-x-[12deg] flex items-center gap-2">
                <Upload className="w-5 h-5 text-white" id="upload-icon" />
                <span>Create Free Account</span>
              </span>
            </button>
            <button
              onClick={() => onGoToAuth('login')}
              className="border-2 border-[#00F2FF] text-[#00F2FF] bg-transparent px-8 py-4 font-black text-lg skew-x-[-12deg] shadow-[4px_4px_0px_#FF007F] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all cursor-pointer font-display inline-flex items-center gap-2 uppercase tracking-wide"
              id="btn-sign-in"
            >
              <span className="inline-block skew-x-[12deg]">
                Sign In
              </span>
            </button>
          </div>

          <div className="flex items-center gap-6 pt-4 text-gray-400 text-xs font-mono" id="hero-badges">
            <div className="flex items-center gap-1.5 border border-[#00F2FF]/30 px-2.5 py-1 bg-black/40">
              <Shield className="w-4 h-4 text-[#00F2FF]" id="shield-badge" />
              <span className="uppercase tracking-widest font-bold text-[10px]">ROT13 ENCRYPTED</span>
            </div>
            <div className="flex items-center gap-1.5 border border-[#FF007F]/30 px-2.5 py-1 bg-black/40">
              <HardDrive className="w-4 h-4 text-[#FF007F]" id="drive-badge" />
              <span className="uppercase tracking-widest font-bold text-[10px]">VIBE-TESTED SHIELD</span>
            </div>
          </div>
        </motion.div>

        {/* Mascot Mascot Card Column */}
        <motion.div 
          className="lg:col-span-5 relative"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          {/* Mascot Dialog Card mimicking full graphic theme */}
          <div className="bg-[#00F2FF] p-1 shadow-[8px_8px_0px_#FF007F] rounded-none">
            <div className="bg-[#0A0E14] p-6 flex flex-col items-center">
              {/* Dynamic Quote bubble above */}
              <motion.div 
                key={mascotQuote}
                className="w-full bg-[#1A1F26] border-2 border-[#00F2FF] p-4 mb-6 relative rounded-none"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              >
                <div className="absolute bottom-[-10px] left-1/2 transform -translate-x-1/2 w-4 h-4 bg-[#1A1F26] border-r-2 border-b-2 border-[#00F2FF] rotate-45"></div>
                <p className="text-xs italic text-gray-200 text-center leading-relaxed font-mono">
                  "{mascotQuote}"
                </p>
              </motion.div>

              {/* Mascot Photo inside exact style frame */}
              <div className="mb-4">
                <MascotAvatar id="leeku" size="xl" className="border-4 border-dashed border-[#FF007F]" />
              </div>

              {/* Mascot badge details */}
              <div className="text-center w-full">
                <h3 className="font-display font-black text-2xl text-[#FF007F] uppercase tracking-widest">LEEKU</h3>
                <span className="block text-[10px] bg-[#00F2FF] text-[#0A0E14] px-2 py-0.5 mt-2 font-bold uppercase tracking-wider w-fit mx-auto">
                  VAULT_GUARDIAN_v1.0
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Core Features Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
        <motion.div 
          className="bg-[#1A1F26]/80 border-2 border-[#00F2FF] p-6 relative"
          whileHover={{ y: -4 }}
        >
          <div className="absolute top-0 right-0 bg-[#00F2FF] text-[#0A0E14] px-2 py-0.5 text-[9px] font-mono font-black uppercase">
            CATBOX_VIBE
          </div>
          <div className="w-12 h-12 bg-[#00F2FF]/10 text-[#00F2FF] border border-[#00F2FF]/40 rounded-none flex items-center justify-center mb-4">
            <Upload className="w-6 h-6" id="feat-upload-logo" />
          </div>
          <h3 className="font-display font-black text-xl italic uppercase text-white mb-2">Simplicity of Catbox</h3>
          <p className="text-gray-300 text-sm leading-relaxed">
            Quick drag-and-drop file transfers with dynamic generation of short, neat share URLs. Download back anytime.
          </p>
        </motion.div>

        <motion.div 
          className="bg-[#1A1F26]/80 border-2 border-[#FF007F] p-6 relative"
          whileHover={{ y: -4 }}
        >
          <div className="absolute top-0 right-0 bg-[#FF007F] text-white px-2 py-0.5 text-[9px] font-mono font-black uppercase">
            MEGA_VIBE
          </div>
          <div className="w-12 h-12 bg-[#FF007F]/10 text-[#FF007F] border border-[#FF007F]/40 rounded-none flex items-center justify-center mb-4">
            <Key className="w-6 h-6" id="feat-key-logo" />
          </div>
          <h3 className="font-display font-black text-xl italic uppercase text-white mb-2">Vault Armor of Mega</h3>
          <p className="text-gray-300 text-sm leading-relaxed">
            All database payloads run through a rotational XOR key encryption script prior to storage. Only authenticated decodes retrieve bytes.
          </p>
        </motion.div>

        <motion.div 
          className="bg-[#1A1F26]/80 border-2 border-[#00FF00] p-6 relative"
          whileHover={{ y: -4 }}
        >
          <div className="absolute top-0 right-0 bg-[#00FF00] text-black px-2 py-0.5 text-[9px] font-mono font-black uppercase font-bold">
            ANTIVIRUS
          </div>
          <div className="w-12 h-12 bg-[#00FF00]/10 text-[#00FF00] border border-[#00FF00]/40 rounded-none flex items-center justify-center mb-4">
            <Shield className="w-6 h-6" id="feat-shield-logo" />
          </div>
          <h3 className="font-display font-black text-xl italic uppercase text-white mb-2">Goblin Scents</h3>
          <p className="text-gray-300 text-sm leading-relaxed">
            Suspicious binary content is sniffed on intake. Files harboring bad spirits or malware payloads are immediately reported, blocked, and locked away.
          </p>
        </motion.div>
      </div>

      {/* Quota Tables Section */}
      <motion.div 
        className="bg-[#1A1F26]/90 border-2 border-[#00F2FF] p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h2 className="font-display font-black text-2xl uppercase tracking-widest text-[#00F2FF]/90">System Storage Allocation</h2>
            <p className="text-xs text-gray-400 font-mono mt-1 uppercase">
              Check our default quota sizes. Level up your leek power easily by joining.
            </p>
          </div>
          <span className="text-xs font-mono text-[#00FF00] uppercase font-bold tracking-widest">[ STATUS: RE-BLOSSOMING DAILY ]</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-[#00F2FF] text-[#00F2FF] uppercase font-black tracking-wider text-xs bg-black/40">
                <th className="py-3 px-4">Quota Tier</th>
                <th className="py-3 px-4">Available Storage</th>
                <th className="py-3 px-4">Max File Size</th>
                <th className="py-3 px-4">Files Limit</th>
                <th className="py-3 px-4">Daily Ingestion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-slate-200">
              {quotas.map((q) => (
                <tr 
                  key={q.id} 
                  className={`hover:bg-[#00F2FF]/5 transition-colors border-b border-gray-800/80 ${q.id === 'guest' ? 'text-[#00F2FF] font-semibold' : ''}`}
                >
                  <td className="py-4 px-4 font-sans font-black flex items-center gap-2 uppercase text-xs italic">
                    <span className="w-2 rounded-none h-4 bg-[#FF007F]"></span>
                    {q.name}
                  </td>
                  <td className="py-4 px-4 text-[#00F2FF] font-bold text-sm">{formatSize(q.storage_limit_bytes)}</td>
                  <td className="py-4 px-4 text-gray-300">{formatSize(q.max_file_size_bytes)}</td>
                  <td className="py-4 px-4 text-slate-400">{q.max_files.toLocaleString()} files</td>
                  <td className="py-4 px-4 text-slate-400">{formatSize(q.daily_upload_limit_bytes)}/day</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Trust Quote / Pitch */}
      <div className="mt-16 text-center border-t border-gray-800 pt-12 max-w-2xl mx-auto">
        <Sparkles className="w-8 h-8 text-[#FF007F] mx-auto mb-4 animate-pulse" id="sparkles-decor" />
        <p className="italic text-gray-300 text-md leading-relaxed font-mono text-sm">
          "Your files aren't just blocks on a server; they're precious packages stored securely in our Vocaloid bunker, guarded by lasers, digital code ciphers, and a persistent craving for leeks."
        </p>
        <span className="block mt-4 text-xs font-mono text-[#00F2FF] font-black uppercase tracking-widest">— Chief Architect of the Green Field</span>
      </div>
    </div>
  );
}
