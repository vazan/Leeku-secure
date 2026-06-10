/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Sparkles, HardDrive, HelpCircle } from 'lucide-react';
import { User, Quota } from './types.js';

// Core layout structures  
import LandingPage from './components/LandingPage.js';
import AuthPage from './components/AuthPage.js';
import UserDashboard from './components/UserDashboard.js';
import PublicDownloadPage from './components/PublicDownloadPage.js';

export default function App() {
  // Session / Cred State  
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Layout View States  
  const [currentView, setCurrentView] = useState<'landing' | 'auth' | 'dashboard' | 'download'>('landing');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [downloadToken, setDownloadToken] = useState<string | null>(null);

  // Quotas Master Matrices  
  const [quotas, setQuotas] = useState<Quota[]>([]);

  // Easter Egg 1 - Logo Clicks Leek Mode
  const [logoClicks, setLogoClicks] = useState(0);
  const [leekMode, setLeekMode] = useState(false);
  const [floatingLeeks, setFloatingLeeks] = useState<{ id: number; left: number; duration: number; delay: number; scale: number; rotateSpeed: number }[]>([]);

  useEffect(() => {
    if (leekMode) {
      const elements = Array.from({ length: 20 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        duration: 4 + Math.random() * 4,
        delay: Math.random() * 2,
        scale: 0.6 + Math.random() * 1.2,
        rotateSpeed: 100 + Math.random() * 260,
      }));
      setFloatingLeeks(elements);
    } else {
      setFloatingLeeks([]);
    }
  }, [leekMode]);

  // 1. Initialise & Sync Hash Deep-Links Route Listeners  
  const handleHashChange = () => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#f/')) {
      const parsedToken = hash.substring(3).trim();
      if (parsedToken) {
        setDownloadToken(parsedToken);
        setCurrentView('download');
      }
    } else {
      setDownloadToken(null);
      // Fallback routes  
      if (user) {
        setCurrentView('dashboard');
      } else {
        setCurrentView('landing');
      }
    }
  };

  // Fetch standard allocations matrices  
  const fetchQuotas = async () => {
    try {
      const res = await fetch('/api/quotas');
      const data = await res.json();
      if (res.ok) {
        setQuotas(data.quotas || []);
      }
    } catch (e) {
      console.error('Failed to grab system allocations metrics.', e);
    }
  };

  // Restore session from secure cookie  
  const restoreSessionFromCookie = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (res.ok && data.user) {
        setUser(data.user);
        setToken('cookie');
        // If we are currently not visiting a file-share path directly, route to dashboard  
        if (!window.location.hash.startsWith('#f/')) {
          setCurrentView('dashboard');
        }
      }
    } catch (e) {
      console.error('Connection failure during credentials validations.', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotas();
    restoreSessionFromCookie();

    // Set listener and run once for initial deep-links checks  
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  // Sync user values if needed (quota capacity recalculations)  
  const handleRefreshUser = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : undefined
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setUser(data.user);
      }
    } catch (e) {
      console.error('Failed user profile sync', e);
    }
  };

  // Handle Log states  
  const handleAuthSuccess = (newToken: string, authedUser: User) => {
    setToken(newToken);
    setUser(authedUser);
    
    // Check if redirect hashes are preserved  
    if (downloadToken) {
      setCurrentView('download');
    } else {
      setCurrentView('dashboard');
    }
  };

  const handleLogout = async () => {
    const csrfToken = document.cookie
    .split('; ')
    .find(row => row.startsWith('leeku_csrf='))
    ?.split('=')[1];

    try {
      await fetch('/api/auth/logout', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || ''
        }
      });
    } catch {
      // Best effort; local state is still cleared.
    }
    setToken('');
    setUser(null);
    window.location.hash = '';
    setCurrentView('landing');
  };

  return (
    <div className="min-h-screen bg-[#0A0E14] text-white font-sans selection:bg-[#00F2FF] selection:text-black">
      
      {/* Floating Leeks Animation Overlay */}
      <AnimatePresence>
        {leekMode && (
          <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
            {floatingLeeks.map((leek) => (
              <motion.div
                key={leek.id}
                className="absolute text-5xl select-none"
                style={{ left: `${leek.left}%`, bottom: '-10%' }}
                initial={{ opacity: 0, y: '0%', scale: 0 }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  y: '-120vh',
                  scale: leek.scale,
                  rotate: [0, leek.rotateSpeed],
                }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: leek.duration,
                  delay: leek.delay,
                  ease: 'linear',
                  repeat: Infinity,
                }}
              >
                🧅
              </motion.div>
            ))}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-[#00F2FF] text-black font-mono font-black italic border-4 border-white px-8 py-4 text-center text-xl uppercase tracking-widest shadow-[0_0_50px_rgba(0,242,255,0.8)] z-50 animate-bounce">
              🎉 LEEK MODE ACTIVE! 🎉
            </div>
          </div>
        )}
      </AnimatePresence>
      
      {/* Dynamic Ambient Neon Mesh Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#00F2FF]/10 blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#FF007F]/10 blur-[120px]"></div>
      </div>

      {/* Primary Navigation Header */}
      <header className="sticky top-0 z-40 bg-[#0A0E14]/90 backdrop-blur-md border-b-2 border-[#00F2FF] px-6 py-4 relative z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          
          {/* Logo element */}
          <div 
            onClick={() => {
              setCurrentView('landing');
              setLogoClicks(prev => {
                const updated = prev + 1;
                if (updated >= 10) {
                  setLeekMode(true);
                  setTimeout(() => {
                    setLeekMode(false);
                    setLogoClicks(0);
                  }, 10000);
                  return 0;
                }
                return updated;
              });
              window.location.hash = '';
              setCurrentView(user ? 'dashboard' : 'landing');
            }}
            className="flex items-center gap-3 cursor-pointer group"
          >
            <div className="w-10 h-10 bg-[#00F2FF] rounded-sm rotate-12 flex items-center justify-center border-2 border-[#FF007F] font-display font-black text-[#0A0E14] text-xl leading-none shadow-[0_0_15px_rgba(0,242,255,0.4)] group-hover:scale-115 transition-transform duration-300">
              L
            </div>
            <div>
              <span className="font-display font-black text-2xl tracking-tighter italic text-[#00F2FF] uppercase group-hover:text-white transition-colors">
                Leeks.<span className="text-[#FF007F]">miku</span>.rip
              </span>
              <span className="block font-mono text-[9px] uppercase tracking-wider text-gray-500 font-bold">Miku Bunker Secure</span>
            </div>
          </div>

          {/* Quick Header actions */}
          <div className="flex items-center gap-4 text-xs font-mono">
            {loading ? (
              <span className="text-slate-500 animate-pulse">Syncing Crypt portals...</span>
            ) : user ? (
              <div className="flex items-center gap-3">
                <span className="text-slate-300 text-xs hidden sm:inline-flex items-center gap-1.5 bg-[#1A1F26] px-3 py-1 border border-[#00F2FF]/40 rounded-none font-bold">
                  <span className="w-2 h-2 rounded-full bg-[#00FF00] animate-ping"></span>
                  <button onClick={() => {
                      setCurrentView('dashboard');
                    }} >@{user.username.toUpperCase()}</button>
                </span>             
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* If on the auth page, render nothing */}
                {currentView === 'auth' ? null : (
                  user ? (
                    // Show Dashboard button (shows on download page or home if logged in)
                    <button
                      onClick={() => {
                        setCurrentView('dashboard');
                      }}
                      className="border-2 border-[#00F2FF] text-[#00F2FF] bg-transparent px-8 py-4 font-black text-lg skew-x-[-12deg] shadow-[4px_4px_0px_#FF007F] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all cursor-pointer font-display inline-flex items-center gap-2 uppercase tracking-wide"
                    >
                      Dashboard
                    </button>
                  ) : (
                    // Show Sign In button (shows if not logged in)
                    <button
                      onClick={() => {
                        setAuthMode('login');
                        setCurrentView('auth');
                      }}
                      className="border-2 border-[#00F2FF] text-[#00F2FF] bg-transparent px-8 py-4 font-black text-lg skew-x-[-12deg] shadow-[4px_4px_0px_#FF007F] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all cursor-pointer font-display inline-flex items-center gap-2 uppercase tracking-wide"
                    >
                      Sign In
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Wrapper Slot */}
      <main className="relative z-10 py-6">
        {loading ? (
          <div className="max-w-md mx-auto my-32 text-center space-y-4">
            <div className="w-12 h-12 border-4 border-[#00F2FF] border-b-transparent rounded-full animate-spin mx-auto" />
            <p className="font-mono text-xs text-[#00F2FF] uppercase tracking-widest">Warming up leek lasers...</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {currentView === 'landing' && (
              <motion.div
                key="landing"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.3 }}
              >
                <LandingPage 
                  quotas={quotas}
                  onGoToAuth={(mode) => {
                    setAuthMode(mode);
                    setCurrentView('auth');
                  }}
                  onSetView={(v) => setCurrentView(v as any)}
                />
              </motion.div>
            )}

            {currentView === 'auth' && (
              <motion.div
                key="auth"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.3 }}
              >
                <AuthPage 
                  initialMode={authMode}
                  onAuthSuccess={handleAuthSuccess}
                  onCancel={() => setCurrentView(user ? 'dashboard' : 'landing')}
                />
              </motion.div>
            )}

            {currentView === 'dashboard' && user && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.3 }}
              >
                <UserDashboard 
                  user={user}
                  token={token}
                  quotas={quotas}
                  onLogout={handleLogout}
                  onTriggerRefreshUser={handleRefreshUser}
                />
              </motion.div>
            )}

            {currentView === 'download' && downloadToken && (
              <motion.div
                key="download"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.3 }}
              >
                <PublicDownloadPage 
                  token={downloadToken}
                  onGoHome={() => {
                    window.location.hash = '';
                    setCurrentView(user ? 'dashboard' : 'landing');
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {/* Universal footer bar */}
      <footer className="relative z-10 border-t-2 border-gray-800 mt-16 py-8 text-center text-xs font-mono text-gray-500 bg-[#1A1F26]/30">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center md:justify-between gap-4">
          <div className="flex gap-6 text-[11px] uppercase">
            <span>Security: <span className="text-[#00FF00] font-bold">Quantum Leek Shield Engaged</span></span>
            <span className="hidden sm:inline">System Logs: <span className="text-cyan-400">0 digital goblins</span></span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[#FF007F] font-black tracking-widest text-[11px] uppercase">© 2026 Leeku Industries / miku.rip</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
