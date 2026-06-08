/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Bitdefender Endpoint Security Scanner
 *
 * Integration method: On-premise CLI (BEST / Bitdefender Endpoint Security Tools).
 * Tested against: Bitdefender Endpoint Security Tools 7.x+
 * Reference: https://www.bitdefender.com/business/support/en/77209-36849-using-the-command-line-interface.html
 *
 * Scan flow:
 *   1. Write the decrypted file bytes to a local temp directory
 *      (FILE_SCAN_TEMP_PATH — must be local, not a UNC share).
 *   2. Invoke the Bitdefender CLI via child_process.spawn (NOT exec,
 *      to prevent command injection from attacker-controlled filenames).
 *   3. Parse exit code + stdout/stderr for threat verdict.
 *   4. Delete the temp file immediately after scanning.
 *   5. Return a structured ScanResult to the caller.
 *
 * Bitdefender CLI typical exit codes:
 *   0   — Clean (no threats detected)
 *   1   — Infected (threat(s) found)
 *   2   — Suspicious (heuristic/PUA flags)
 *   3+  — Engine error, timeout, permission denied, etc.
 *
 * Common CLI executables (auto-detected in order):
 *   1. bdscan.exe                    (BEST classic scanner)
 *   2. product.console.exe           (BEST modern interface)
 *   3. C:\Program Files\Bitdefender\Endpoint Security\...
 *
 * If no scanner is found, status 'Unavailable' is returned so the
 * application can fall back to heuristic checks and still accept/reject.
 *
 * Environment variables:
 *   BITDEFENDER_SCAN_CLI_PATH  — explicit path to scanner (overrides auto-detect)
 *   BITDEFENDER_TIMEOUT_MS     — max ms to wait (default 30 000)
 *   BITDEFENDER_EXTRA_ARGS     — optional CLI flags (space-separated)
 *   FILE_SCAN_TEMP_PATH        — local temp dir for staging (default C:\LeekuTemp\scan-staging)
 */

import { spawn } from 'child_process';
import fs   from 'fs';
import path from 'path';
import crypto from 'crypto';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type ScanStatus =
  | 'Clean'        // Bitdefender found no threats
  | 'Infected'     // One or more threats detected
  | 'Suspicious'   // Heuristic flag — not definitively infected
  | 'Error'        // Scanner encountered an internal error
  | 'Timeout'      // Scanner did not respond within the timeout
  | 'Unavailable'; // Scanner binary not found / not configured

export interface ScanResult {
  clean:           boolean;
  status:          ScanStatus;
  threats:         string[];
  message:         string;
  scanDurationMs:  number;
}

// ──────────────────────────────────────────────────────────────
// Configuration (from env)
// ──────────────────────────────────────────────────────────────

/**
 * Detects the Bitdefender CLI scanner executable via:
 *   1. Explicit BITDEFENDER_SCAN_CLI_PATH env var (highest priority)
 *   2. Searching common installation paths (product.console.exe first — more modern)
 *
 * Returns null if no scanner is found (graceful degradation).
 */
function getScanCliPath(): string | null {
  // 1. Check explicit env var first
  if (process.env.BITDEFENDER_SCAN_CLI_PATH) {
    return process.env.BITDEFENDER_SCAN_CLI_PATH;
  }

  // 2. Try common Bitdefender installation paths
  // Prioritize product.console.exe (newer/faster) over bdscan.exe (legacy)
  const commonPaths = [
    'C:\\Program Files\\Bitdefender\\Endpoint Security Tools\\product.console.exe',
    'C:\\Program Files\\Bitdefender\\Endpoint Security\\product.console.exe',
    'C:\\Program Files (x86)\\Bitdefender\\Endpoint Security Tools\\product.console.exe',
    'C:\\Program Files\\Bitdefender\\Endpoint Security Tools\\bdscan.exe',
    'C:\\Program Files\\Bitdefender\\Endpoint Security\\bdscan.exe',
    'C:\\Program Files (x86)\\Bitdefender\\Endpoint Security Tools\\bdscan.exe',
  ];

  for (const path of commonPaths) {
    if (fs.existsSync(path)) {
      console.log(`[scanner] Auto-detected Bitdefender CLI at: ${path}`);
      return path;
    }
  }

  return null;
}

function getScanTimeoutMs(): number {
  return parseInt(process.env.BITDEFENDER_TIMEOUT_MS || '30000', 10);
}

function getScanTempPath(): string {
  return process.env.FILE_SCAN_TEMP_PATH || 'C:\\LeekuTemp\\scan-staging';
}

/** Returns extra CLI args from env, split safely on spaces. */
function getExtraArgs(): string[] {
  const raw = (process.env.BITDEFENDER_EXTRA_ARGS || '').trim();
  return raw ? raw.split(' ').filter(Boolean) : [];
}

function previewOutput(value: string, maxLength: number = 300): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '[empty]';
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

// ──────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────

/**
 * Scans a buffer of file bytes using the Bitdefender CLI.
 *
 * @param fileBytes  Raw (decrypted) file content to scan.
 * @param mimeType   MIME type of the file (used for pre-flight heuristics).
 * @returns          Structured ScanResult with clean/infected verdict.
 */
export async function scanFileBuffer(
  fileBytes: Buffer,
  mimeType:  string
): Promise<ScanResult> {
  const cliPath    = getScanCliPath();
  const timeoutMs  = getScanTimeoutMs();
  const tempDir    = getScanTempPath();

  console.info(
    `[scanner] Starting scan. bytes=${fileBytes.length} mime=${mimeType || 'unknown'} tempDir="${tempDir}" timeoutMs=${timeoutMs} cliPath=${cliPath || '[not found]'}`
  );

  // ── Pre-flight: check scanner binary exists ──────────────────
  if (!cliPath) {
    console.warn('[scanner] Bitdefender CLI not found in common paths or BITDEFENDER_SCAN_CLI_PATH.');
    return {
      clean:          false,
      status:         'Unavailable',
      threats:        [],
      message:        'Bitdefender scanner not available. Heuristic scanning may still apply.',
      scanDurationMs: 0,
    };
  }

  if (!fs.existsSync(cliPath)) {
    console.warn(`[scanner] Bitdefender CLI path does not exist: ${cliPath}`);
    return {
      clean:          false,
      status:         'Unavailable',
      threats:        [],
      message:        `Scanner not found at "${cliPath}". Check BITDEFENDER_SCAN_CLI_PATH.`,
      scanDurationMs: 0,
    };
  }

  // ── Ensure temp directory exists ────────────────────────────
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.info(`[scanner] Created scan temp directory: ${tempDir}`);
  }

  // ── Write bytes to a randomly-named temp file ───────────────
  // Use a random name so the filename cannot influence the scan result
  // and there are no collisions under concurrent uploads.
  const tempFileName = crypto.randomBytes(16).toString('hex') + '.scan';
  const tempFilePath = path.join(tempDir, tempFileName);

  try {
    fs.writeFileSync(tempFilePath, fileBytes);
    console.info(`[scanner] Wrote temp scan file: ${tempFilePath}`);
  } catch (err) {
    console.error('[scanner] Failed to write temp scan file.', { tempFilePath, tempDir, error: (err as Error).message });
    return {
      clean:          false,
      status:         'Error',
      threats:        [],
      message:        `Failed to write scan staging file: ${(err as Error).message}`,
      scanDurationMs: 0,
    };
  }

  // ── Run the scanner ──────────────────────────────────────────
  try {
    return await runScanner(cliPath, tempFilePath, timeoutMs);
  } finally {
    // Always delete the temp file, even if the scan throws
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (cleanupErr) {
      console.error('[scanner] Failed to delete scan temp file:', tempFilePath, cleanupErr);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// Internal: spawn scanner process
// ──────────────────────────────────────────────────────────────

function runScanner(
  cliPath:     string,
  filePath:    string,
  timeoutMs:   number
): Promise<ScanResult> {
  return new Promise((resolve) => {
    const extraArgs  = getExtraArgs();
    const executable = path.basename(cliPath).toLowerCase();
    const isProductConsole = executable === 'product.console.exe';
    const commandAttempts = isProductConsole
      ? [['/c', 'FileScan.OnDemand.RunScanTask', 'custom', `path="${filePath}"`, ...extraArgs]]
      : [[...extraArgs, filePath]];

    const finishFromExit = (exitCode: number | null, stdout: string, stderr: string, scanDurationMs: number): void => {
      const launchError = /not recognized as an internal or external command|failed to launch|access is denied|cannot find|invalid command|error 1639/i.test(`${stdout}\n${stderr}`);

      switch (exitCode) {
        case 0:
          resolve({
            clean:          true,
            status:         'Clean',
            threats:        [],
            message:        'No threats detected by Bitdefender.',
            scanDurationMs,
          });
          return;

        case 1: {
          const threats = parseThreatsFromOutput(stdout, stderr);
          if (!threats.length && launchError) {
            resolve({
              clean:          false,
              status:         'Error',
              threats:        [],
              message:        stderr.trim() || stdout.trim() || 'Bitdefender command execution failed.',
              scanDurationMs,
            });
            return;
          }
          resolve({
            clean:          false,
            status:         'Infected',
            threats,
            message:        threats.length > 0
                              ? `Threat(s) detected: ${threats.join(', ')}`
                              : 'Threat detected by Bitdefender.',
            scanDurationMs,
          });
          return;
        }

        case 2:
          resolve({
            clean:          false,
            status:         'Suspicious',
            threats:        parseThreatsFromOutput(stdout, stderr),
            message:        'Suspicious or heuristic flags detected (PUA, archive bomb, etc.).',
            scanDurationMs,
          });
          return;

        default:
          resolve({
            clean:          false,
            status:         'Error',
            threats:        [],
            message:        `Bitdefender exited with code ${exitCode}. ${stderr.trim() || stdout.trim() || 'Check Bitdefender service status.'}`.trim(),
            scanDurationMs,
          });
        return;
      }
    };

    const runAttempt = (attemptIndex: number): void => {
      const startTime = Date.now();
      const commandArgs = commandAttempts[attemptIndex];
      const attemptLabel = `${attemptIndex + 1}/${commandAttempts.length}`;

      console.info(
        `[scanner] Launching CLI. cliPath="${cliPath}" filePath="${filePath}" mode=${isProductConsole ? 'product-console' : 'direct'} attempt=${attemptLabel} args=${JSON.stringify(commandArgs)}`
      );

      const proc = spawn(cliPath, commandArgs, {
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        console.warn(`[scanner] Scan timed out after ${timeoutMs} ms for ${filePath} on attempt ${attemptLabel}`);
        resolve({
          clean:          false,
          status:         'Timeout',
          threats:        [],
          message:        `Bitdefender scan timed out after ${timeoutMs} ms.`,
          scanDurationMs: Date.now() - startTime,
        });
      }, timeoutMs);

      proc.on('close', (exitCode: number | null) => {
        clearTimeout(timer);
        const scanDurationMs = Date.now() - startTime;
        const invalidCommand = exitCode === 1639 || /invalid command|error 1639/i.test(`${stdout}\n${stderr}`);

        console.info(
          `[scanner] CLI exited. attempt=${attemptLabel} code=${exitCode} durationMs=${scanDurationMs} stdout=${previewOutput(stdout)} stderr=${previewOutput(stderr)}`
        );

        if (invalidCommand && attemptIndex < commandAttempts.length - 1) {
          console.warn(`[scanner] Product console rejected command syntax on attempt ${attemptLabel}; retrying next argument pattern.`);
          runAttempt(attemptIndex + 1);
          return;
        }

        finishFromExit(exitCode, stdout, stderr, scanDurationMs);
      });

      proc.on('error', (err: Error) => {
        clearTimeout(timer);
        console.error('[scanner] Failed to launch scanner process.', {
          cliPath,
          filePath,
          attempt: attemptLabel,
          error: err.message,
        });
        resolve({
          clean:          false,
          status:         'Error',
          threats:        [],
          message:        `Failed to launch Bitdefender scanner: ${err.message}`,
          scanDurationMs: Date.now() - startTime,
        });
      });
    };

    runAttempt(0);
  });
}

// ──────────────────────────────────────────────────────────────
// Internal: parse threat names from CLI output
// ──────────────────────────────────────────────────────────────

/**
 * Parses Bitdefender CLI stdout/stderr to extract detected threat names.
 *
 * Typical output patterns from bdscan or product.console:
 *   /path/to/file.scan  infected: Gen:Trojan.Heur.RP.E5BB05DE1A
 *   /path/to/file.scan  infected: EICAR-Test-File
 *   detected: Trojan.Generic
 *   Threat found: W32/Rootkit.agouti
 */
function parseThreatsFromOutput(stdout: string, stderr: string = ''): string[] {
  const threats = new Set<string>();
  const combined = `${stdout}\n${stderr}`;

  for (const line of combined.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match "infected: ThreatName" or "detected: ThreatName" patterns
    let threatMatch = trimmed.match(/(?:infected|detected|found|alert):\s*(.+?)(?:\s+|$)/i);
    if (threatMatch) {
      const name = threatMatch[1].trim();
      if (name && name.length > 2) {
        threats.add(name);
        continue;
      }
    }

    // Fallback: match common threat name patterns
    // Gen:Trojan.xxx, Trojan.xxx, W32/xxx, etc.
    const nameMatch = trimmed.match(
      /\b(Gen:|W32\/|Win32\/|Trojan\.|Virus\.|Backdoor\.|Worm\.|Ransom\.|Adware\.|Spyware\.)\S+/i
    );
    if (nameMatch) {
      threats.add(nameMatch[0].trim());
    }
  }

  return Array.from(threats);
}

// ──────────────────────────────────────────────────────────────
// Heuristic pre-scan (runs BEFORE Bitdefender, no external call)
// ──────────────────────────────────────────────────────────────

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.ps1',
  '.vbs', '.js',  '.wsf', '.hta', '.scr', '.pif',
  '.jar', '.sh',  '.py',  '.rb',  '.pl',
]);

/**
 * Fast heuristic check that runs before Bitdefender to immediately
 * reject obviously dangerous file types, saving scan time.
 *
 * Returns null if the file passes heuristics (proceed to full scan),
 * or a ScanResult if it should be rejected immediately.
 */
export function heuristicPreScan(
  originalName: string,
  _mimeType:    string
): ScanResult | null {
  const ext = path.extname(originalName).toLowerCase();

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return {
      clean:          false,
      status:         'Infected',
      threats:        [`Blocked file extension: ${ext}`],
      message:        `File type "${ext}" is not permitted. Executables and scripts are blocked.`,
      scanDurationMs: 0,
    };
  }

  return null; // passes heuristics — proceed to Bitdefender scan
}
