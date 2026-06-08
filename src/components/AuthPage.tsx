/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Mail, Lock, User as UserIcon, ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { User } from '../types.js';

interface AuthPageProps {
  initialMode: 'login' | 'register';
  onAuthSuccess: (token: string, user: User) => void;
  onCancel: () => void;
}

export default function AuthPage({ initialMode, onAuthSuccess, onCancel }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [regSuccess, setRegSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setRegSuccess(false);

    const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const payload = mode === 'login' 
      ? { email, password } 
      : { username, email, password };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong. The leeks are running away!');
      }

      // Success — check if we got a token (login or dev mode)
      if (data.token && data.user) {
        onAuthSuccess(data.token, data.user);
      } else if (data.success && data.message) {
        // Registration with email verification required
        setRegSuccess(true);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network communication glitch.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <motion.div 
        className="bg-[#0A0E14] border-4 border-[#00F2FF] p-8 shadow-[8px_8px_0px_#FF007F] relative overflow-hidden"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Cyber Badge */}
        <div className="absolute top-0 right-0 bg-[#00F2FF] text-[#0A0E14] px-3 py-1 font-black text-xs uppercase tracking-wider">
          GATE_PORTAL_V1.1
        </div>

        {/* Back navigation */}
        <button 
          onClick={onCancel}
          className="px-3 py-1 bg-black border border-[#00F2FF] text-[#00F2FF] font-mono text-[10px] uppercase font-bold hover:bg-[#00F2FF]/20 transition-colors mb-6 flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Exit Gate</span>
        </button>

        <div className="mb-6 text-center">
          <div className="inline-flex w-14 h-14 bg-[#0A0E14] border-2 border-[#FF007F] items-center justify-center text-[#FF007F] mb-3">
            <Shield className="w-7 h-7 animate-pulse" id="auth-shield-logo" />
          </div>
          <h2 className="font-display font-black text-3xl text-white uppercase italic tracking-tighter">
            {mode === 'login' ? 'VERIFY IDENTITY' : 'REGISTER ENTRANT'}
          </h2>
          <p className="text-gray-400 font-mono text-[11px] uppercase mt-1">
            {mode === 'login' 
              ? 'Leeku is ready to secure your file transfers.' 
              : 'Deploy your assets inside our cyber-kawaii bunker.'}
          </p>
        </div>

        {/* Error Notification banner */}
        <AnimatePresence mode="wait">
          {errorMsg && (
            <motion.div 
              className="bg-black border-2 border-[#FF007F] p-3 mb-6 text-[#FF007F] text-xs font-mono uppercase"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              ⚠️ GOBLIN DETECTED: {errorMsg.toUpperCase()}
            </motion.div>
          )}
          {regSuccess && (
            <motion.div 
              className="bg-black border-2 border-[#00F2FF] p-4 mb-6 text-[#00F2FF] text-xs font-mono"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="text-center">
                <span className="text-lg">📬</span>
                <p className="mt-2 font-bold uppercase">VERIFICATION EMAIL SENT</p>
                <p className="mt-1 text-gray-400 normal-case">Check <strong className="text-[#00F2FF]">{email}</strong> and click the link to activate your account. Then you can log in.</p>
                <button 
                  type="button"
                  onClick={() => { setRegSuccess(false); setMode('login'); setErrorMsg(''); }}
                  className="mt-3 px-4 py-2 bg-[#00F2FF] text-[#0A0E14] font-black uppercase text-[10px] hover:bg-[#00F2FF]/80 transition-colors cursor-pointer"
                >
                  GO TO LOGIN
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Show form only if not in success state */}
        {!regSuccess && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-[10px] font-mono text-[#00F2FF] uppercase font-black tracking-wider mb-1.5 font-bold">Username</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"><UserIcon className="w-4 h-4" /></span>
                <input 
                  type="text"
                  required
                  placeholder="MikuFan44"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-none bg-[#1A1F26] border-2 border-gray-800 text-white placeholder-gray-600 focus:outline-none focus:border-[#00F2FF] text-xs font-mono transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-mono text-[#00F2FF] uppercase font-black tracking-wider mb-1.5 font-bold">Email Address</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"><Mail className="w-4 h-4" /></span>
              <input 
                type="email"
                required
                placeholder="yourname@leek.sh"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-none bg-[#1A1F26] border-2 border-gray-800 text-white placeholder-gray-600 focus:outline-none focus:border-[#00F2FF] text-xs font-mono transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-[#00F2FF] uppercase font-black tracking-wider mb-1.5 font-bold">Security Key (Password)</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"><Lock className="w-4 h-4" /></span>
              <input 
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-none bg-[#1A1F26] border-2 border-gray-800 text-white placeholder-gray-600 focus:outline-none focus:border-[#00F2FF] text-xs font-mono transition-colors"
              />
            </div>
            {mode === 'login' && (
              <span className="block mt-1 text-[10px] text-gray-500 font-mono text-right">
                Hint: Standard user is <code className="text-[#00F2FF] font-bold">user@miku.rip</code> / <code className="text-[#00F2FF] font-bold">user123</code>
              </span>
            )}
            {mode === 'register' && (
              <span className="block mt-1 text-[10px] text-gray-500 font-mono">
                Secret: add "admin" anywhere to register as an Administrator.
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 mt-2 font-black uppercase text-sm skew-x-[-12deg] bg-[#FF007F] text-white shadow-[4px_4px_0px_#00F2FF] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer font-display disabled:opacity-50 disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-[4px_4px_0px_#00F2FF]"
          >
            {loading ? (
              <span className="inline-block skew-x-[12deg] flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Decrypting Vault Seals...</span>
              </span>
            ) : (
              <span className="inline-block skew-x-[12deg] flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4 text-white" />
                <span>{mode === 'login' ? 'Confirm Identity' : 'Initiate Green Vault'}</span>
              </span>
            )}
          </button>
        </form>
        )}

        <div className="mt-6 border-t border-gray-800 pt-4 text-center">
          <button 
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setErrorMsg('');
            }}
            className="text-xs font-black font-mono text-[#00F2FF] hover:text-[#FF007F] uppercase tracking-wider hover:underline transition-colors cursor-pointer"
          >
            {mode === 'login' 
              ? "Don't have an account? Initiate register sequence →" 
              : "Already verified? Authenticate key here →"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
