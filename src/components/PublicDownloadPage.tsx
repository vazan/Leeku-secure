/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Shield, Lock, Download, AlertTriangle, Loader2, Sparkles, CheckCircle, ArrowLeft } from 'lucide-react';
import leekuMascot from '../leeku_mascot.png';
import { MascotAvatar } from './Mascots.js';
import ErrorScreen from './ErrorScreen.js';

interface PublicDownloadPageProps {
  token: string;
  onGoHome: () => void;
}

interface PublicFileMeta {
  token: string;
  file_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  protected: boolean;
  uploader: string;
  leeku_vibe: string;
  downloads_current: number;
  downloads_max: number | null;
}

export default function PublicDownloadPage({ token, onGoHome }: PublicDownloadPageProps) {
  // Page States
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PublicFileMeta | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Interactive Download States
  const [password, setPassword] = useState('');
  const [downLoading, setDownLoading] = useState(false);
  const [downError, setDownError] = useState('');
  const [downSuccess, setDownSuccess] = useState(false);

  // Fetch Metadata of the Shared Token
  const fetchMetadata = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/public/share/${token}`);
      const data = await res.json();
      if (res.ok) {
        setMeta(data);
      } else {
        setErrorMsg(data.error || 'The sharing gateway failed to acknowledge this token.');
      }
    } catch (e) {
      setErrorMsg('Network outage. The leek capsule is offline.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchMetadata();
    }
  }, [token]);

  // Request actual download file decryption
  const triggerDownloadDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    setDownLoading(true);
    setDownError('');
    setDownSuccess(false);

    try {
      const res = await fetch(`/api/public/share/${token}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Vault decryption failed. Double check your credentials.');
      }

      // Convert Base64 payload back to direct blob stream
      const decodedBytes = atob(data.content);
      const byteNumbers = new Array(decodedBytes.length);
      for (let i = 0; i < decodedBytes.length; i++) {
        byteNumbers[i] = decodedBytes.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: data.mime_type || 'application/octet-stream' });
      
      // Creating virtual trigger anchor to fetch browser grab
      const objUrl = URL.createObjectURL(blob);
      const tempAnchor = document.createElement('a');
      tempAnchor.href = objUrl;
      tempAnchor.download = data.original_name || 'secured_leek_file.bin';
      document.body.appendChild(tempAnchor);
      tempAnchor.click();
      document.body.removeChild(tempAnchor);
      URL.revokeObjectURL(objUrl);

      setDownSuccess(true);
      // Refresh meta downloads count
      setTimeout(() => {
        fetchMetadata();
      }, 1000);
    } catch (err: any) {
      setDownError(err.message || 'Failure while decrypting rotational stream.');
    } finally {
      setDownLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="max-w-xl mx-auto my-12 px-4 pb-16">
      {/* Dynamic State: Loader */}
      {loading && (
        <div className="bg-[#0A0E14] border-4 border-[#00F2FF] p-16 text-center space-y-4 shadow-[8px_8px_0px_#FF007F]">
          <Loader2 className="w-12 h-12 text-[#00F2FF] animate-spin mx-auto" />
          <p className="font-mono text-xs text-[#00F2FF] animate-pulse">SCANNING VORTEX FOR COORDS: {token}...</p>
        </div>
      )}

      {/* Dynamic State: 404 / 410 / ERROR */}
      {!loading && errorMsg && (
        <ErrorScreen code={404} onGoBack={onGoHome} />
      )}

      {/* Dynamic State: METADATA RETRIEVED - CONFIRME DOWNLOAD FORM */}
      {!loading && meta && (
        <motion.div
          className="bg-[#0A0E14] border-4 border-[#00F2FF] p-8 shadow-[8px_8px_0px_#FF007F] space-y-6 relative overflow-hidden"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Cyber Badge */}
          <div className="absolute top-0 right-0 bg-[#00F2FF] text-[#0A0E14] px-3 py-1 font-black text-xs uppercase tracking-wider">
            DECRYPT_SYS_V1.9
          </div>

          {/* Core File Box Header */}
          <div className="border-b-2 border-gray-800 pb-5">
            <div className="flex items-center gap-3.5 mb-4">
              <div className="w-14 h-14 bg-black border-2 border-[#00F2FF] text-[#00F2FF] flex items-center justify-center text-2xl">
                💾
              </div>
              <div className="overflow-hidden">
                <h2 className="font-display font-black text-white text-xl truncate uppercase italic tracking-tight" title={meta.file_name}>{meta.file_name}</h2>
                <span className="text-[11px] font-mono text-slate-400 truncate block mt-0.5 uppercase font-bold">{meta.mime_type} • {formatBytes(meta.size)}</span>
              </div>
            </div>

            {/* Leeku's Guard Report Verdict Stickers */}
            <div className="p-3.5 bg-[#1A1F26] border-2 border-gray-800 relative">
              <span className="absolute top-1 right-2 font-mono text-[9px] text-white bg-[#FF007F] px-1.5 font-bold uppercase tracking-widest">GUARD VERDICT</span>
              <div className="flex gap-2.5 items-start">
                <div className="flex-shrink-0">
                  <MascotAvatar id="leeku" size="xs" />
                </div>
                <div>
                  <span className="font-mono text-[10px] text-gray-400 font-bold uppercase tracking-wide">Leeku Guard Scan Comment:</span>
                  <p className="text-xs text-[#00FF00] italic font-mono mt-0.5">"{meta.leeku_vibe}"</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sharing Properties List metadata */}
          <div className="grid grid-cols-2 gap-4 text-[10px] font-mono bg-[#1A1F26] border-2 border-gray-800 p-4">
            <div>
              <span className="text-gray-500 block font-bold">UPLOADER</span>
              <span className="text-[#00F2FF] font-black font-mono mt-0.5 block uppercase">@{meta.uploader}</span>
            </div>
            <div>
              <span className="text-gray-500 block font-bold">UPLOAD_DATE</span>
              <span className="text-gray-300 mt-0.5 block font-bold">{new Date(meta.created_at).toLocaleDateString()}</span>
            </div>
            <div>
              <span className="text-gray-500 block font-bold">ENC_PORTAL_TYPE</span>
              <span className="text-[#FF007F] mt-0.5 font-black block flex items-center gap-1 uppercase">
                <Shield className="w-3.5 h-3.5" />
                {meta.protected ? 'XOR LOCKED' : 'OPEN LINK'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block font-bold">GRAB_COUNT</span>
              <span className="text-gray-300 mt-0.5 block font-bold uppercase">
                {meta.downloads_current} {meta.downloads_max ? `/ ${meta.downloads_max}` : 'grabs'}
              </span>
            </div>
          </div>

          {/* Interactive Decryption Trigger */}
          <form onSubmit={triggerDownloadDecrypt} className="space-y-4">
            {meta.protected && (
              <div className="bg-black border-2 border-gray-800 p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono text-[#00F2FF] uppercase font-black tracking-widest flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-[#FF007F]" />
                    Vault Access Key
                  </label>
                  <span className="text-[9px] font-mono text-[#FF007F] font-black uppercase">ENCRYPTED GATE</span>
                </div>
                <input 
                  type="password"
                  required
                  placeholder="Insert secure share password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-[#1A1F26] border-2 border-gray-800 focus:border-[#FF007F] text-white placeholder-gray-600 focus:outline-none text-xs text-center font-mono"
                />
              </div>
            )}

            {downError && (
              <div className="bg-black border-2 border-[#FF007F] p-3 text-xs text-[#FF007F] font-mono uppercase text-center">
                ❌ METRICS EXCEPTION: {downError.toUpperCase()}
              </div>
            )}

            {downSuccess && (
              <div className="bg-black border-2 border-[#00FF00] p-3 text-xs text-[#00FF00] font-mono uppercase flex items-center justify-center gap-2">
                <CheckCircle className="w-4 h-4 animate-bounce" />
                <span>Layers dissolved! Download started successfully.</span>
              </div>
            )}

            <button
              type="submit"
              disabled={downLoading}
              className="w-full py-4 bg-[#FF007F] text-white font-black italic text-lg uppercase skew-x-[-12deg] shadow-[4px_4px_0px_#00F2FF] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer font-display disabled:opacity-50 disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-[4px_4px_0px_#00F2FF]"
            >
              {downLoading ? (
                <span className="inline-block skew-x-[12deg] flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>XOR Shields Dissolving...</span>
                </span>
              ) : (
                <span className="inline-block skew-x-[12deg] flex items-center justify-center gap-2">
                  <Download className="w-4 h-4 text-white" />
                  <span>Decrypt File & Download</span>
                </span>
              )}
            </button>
          </form>

          {/* Secure details quote */}
          <div className="text-center font-mono text-[9px] text-gray-550 border-t border-gray-800 pt-3 flex items-center justify-center gap-1.5 uppercase font-bold text-gray-500">
            <span>Power protection matrix: VIBRANT LEEK</span>
            <span>•</span>
            <button type="button" onClick={onGoHome} className="text-[#00F2FF] hover:underline uppercase cursor-pointer">Return Home</button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
