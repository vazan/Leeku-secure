/**
 * @license SPDX-License-Identifier: Apache-2.0
 *
 * Leeku Secure — Email Verification Service
 *
 * Sends verification emails via SMTP (nodemailer) with config from .env.
 * Also performs MX record validation on the recipient's domain.
 */

import dns from 'dns';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// ──────────────────────────────────────────────────────────────
// SMTP Configuration from .env
// ──────────────────────────────────────────────────────────────

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const secure = process.env.SMTP_SECURE === 'true'; // true for 465, false for 587
  const tlsRejectUnauthorized = process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false';

  if (!host || !user || !pass) {
    throw new Error('[email] SMTP_HOST, SMTP_USER, and SMTP_PASSWORD must be set in .env');
  }

  return {
    host, port, secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: tlsRejectUnauthorized },
  };
}

function getSmtpFromAddress(): string {
  const from = String(process.env.SMTP_USER || '').trim();
  if (!from) {
    throw new Error('[email] SMTP_USER must be set in .env');
  }
  return from;
}

// ──────────────────────────────────────────────────────────────
// Singleton transporter (lazy)
// ──────────────────────────────────────────────────────────────

let transporter: Transporter | null = null;
let transporterConfigSignature = '';

function maskEmail(value: string): string {
  const trimmed = String(value || '').trim();
  const at = trimmed.indexOf('@');
  if (at <= 1) return '***';
  return `${trimmed.slice(0, 2)}***${trimmed.slice(at)}`;
}

function buildTransporterSignature(config: ReturnType<typeof getSmtpConfig>): string {
  return [
    config.host,
    String(config.port),
    String(config.secure),
    String(config.tls?.rejectUnauthorized),
    String(config.auth?.user || ''),
    String(config.auth?.pass || ''),
  ].join('|');
}

function getTransporter(): Transporter {
  const config = getSmtpConfig();
  const signature = buildTransporterSignature(config);
  const smtpFrom = getSmtpFromAddress();

  if (!transporter || transporterConfigSignature !== signature) {
    transporter = nodemailer.createTransport(config);
    transporterConfigSignature = signature;
    console.log(
      `[email] SMTP transporter created: ${config.host}:${config.port} ` +
      `(secure=${config.secure}, auth=${maskEmail(String(config.auth.user))}, from=${maskEmail(smtpFrom)})`
    );
  }
  return transporter;
}

/**
 * Verify the SMTP connection works at startup.
 */
export async function verifySmtpConnection(): Promise<void> {
  try {
    await getTransporter().verify();
    console.log('[email] SMTP connection verified — ready to send.');
  } catch (err: any) {
    console.error('[email] SMTP connection verification failed:', err.message);
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────
// MX Record Validation
// ──────────────────────────────────────────────────────────────

/**
 * Checks whether the domain of an email address has valid MX records.
 * Returns { valid: true, domain } or { valid: false, reason }.
 */
export async function validateMxRecord(email: string): Promise<{ valid: boolean; domain?: string; reason?: string }> {
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[1]) {
    return { valid: false, reason: 'Invalid email format — missing domain part.' };
  }

  const domain = parts[1].toLowerCase().trim();

  // Block obviously disposable / example domains (expand as needed)
  const blockedDomains = ['example.com', 'example.org', 'test.com', 'localhost', 'invalid'];
  if (blockedDomains.includes(domain)) {
    return { valid: false, reason: `The domain "${domain}" is not allowed for registration.` };
  }

  try {
    const addresses = await dns.promises.resolveMx(domain);
    if (!addresses || addresses.length === 0) {
      return { valid: false, reason: `The domain "${domain}" has no mail (MX) records and cannot receive email.` };
    }
    return { valid: true, domain };
  } catch (err: any) {
    // ENODATA / ENOTFOUND — no MX records at all
    if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
      return { valid: false, reason: `The domain "${domain}" has no mail (MX) records. Please use a valid email address.` };
    }
    // Temporary DNS failure — allow with warning
    console.warn(`[email] DNS MX lookup temporarily failed for "${domain}":`, err.message);
    return { valid: true, domain, reason: 'MX lookup temporarily unavailable — verification will be sent but may not arrive.' };
  }
}

// ──────────────────────────────────────────────────────────────
// Send verification email
// ──────────────────────────────────────────────────────────────

/**
 * Sends an email verification message to the user.
 * @param to Recipient email address
 * @param username The user's display name
 * @param token The verification token
 */
export async function sendVerificationEmail(to: string, username: string, token: string): Promise<void> {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const verifyUrl = `${appUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

  const html = `
<div style="max-width:600px;margin:0 auto;font-family:monospace;background:#0A0E14;border:3px solid #00F2FF;padding:32px;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="background:#FF007F;color:#fff;padding:4px 12px;font-size:10px;font-weight:900;letter-spacing:2px;">LEEKU_SECURE_VERIFY</span>
  </div>
  <h1 style="color:#00F2FF;text-align:center;font-size:22px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">
    Verify Your Identity
  </h1>
  <p style="color:#ccc;text-align:center;font-size:12px;margin:0 0 24px;">
    Hello <strong style="color:#FF007F;">${username}</strong>,<br/>
    One last step before we can let you in.
  </p>
  <div style="text-align:center;margin:32px 0;">
    <a href="${verifyUrl}" style="display:inline-block;background:#FF007F;color:#fff;padding:14px 36px;font-size:14px;font-weight:900;text-transform:uppercase;text-decoration:none;letter-spacing:2px;border:2px solid #00F2FF;">
      Confirm Email Address
    </a>
  </div>
  <p style="color:#555;text-align:center;font-size:10px;margin:24px 0 0;">
    If you didn't create an account, ignore this message.<br/>
    Token expires in 24 hours.
  </p>
  <p style="color:#444;text-align:center;font-size:9px;">
    &mdash; The Leeku Secure team
  </p>
</div>`;

  const displayFrom = getSmtpFromAddress();

  await getTransporter().sendMail({
    from: `"Leeku Secure" <${displayFrom}>`,
    to,
    subject: 'Verify your email — Leeku Secure',
    html,
    envelope: {
      from: displayFrom,
      to,
    },
  });

  console.log(`[email] Verification email sent to ${to} (envelope from: ${displayFrom})`);
}

interface QuotaChangeRequestEmailPayload {
  requesterUsername: string;
  requesterEmail: string;
  currentPlanName: string;
  requestedPlanName: string;
  note: string;
}

export async function sendQuotaChangeRequestEmail(
  recipients: string[],
  payload: QuotaChangeRequestEmailPayload,
): Promise<void> {
  if (!recipients.length) {
    throw new Error('[email] At least one admin recipient is required for quota change request emails');
  }

  const html = `
<div style="max-width:680px;margin:0 auto;font-family:monospace;background:#0A0E14;border:3px solid #00F2FF;padding:32px;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="background:#00F2FF;color:#0A0E14;padding:4px 12px;font-size:10px;font-weight:900;letter-spacing:2px;">LEEKU_QUOTA_REQUEST</span>
  </div>
  <h1 style="color:#00F2FF;text-align:center;font-size:22px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">
    Quota Upgrade Request
  </h1>
  <p style="color:#ccc;text-align:center;font-size:12px;margin:0 0 24px;">
    A user submitted a request to change their quota plan.
  </p>
  <table style="width:100%;border-collapse:collapse;background:#0F1419;border:1px solid #1f2a3a;">
    <tr><td style="padding:10px;border-bottom:1px solid #1f2a3a;color:#8aa1bf;">User</td><td style="padding:10px;border-bottom:1px solid #1f2a3a;color:#fff;">${payload.requesterUsername}</td></tr>
    <tr><td style="padding:10px;border-bottom:1px solid #1f2a3a;color:#8aa1bf;">Email</td><td style="padding:10px;border-bottom:1px solid #1f2a3a;color:#fff;">${payload.requesterEmail}</td></tr>
    <tr><td style="padding:10px;border-bottom:1px solid #1f2a3a;color:#8aa1bf;">Current plan</td><td style="padding:10px;border-bottom:1px solid #1f2a3a;color:#fff;">${payload.currentPlanName}</td></tr>
    <tr><td style="padding:10px;color:#8aa1bf;">Requested plan</td><td style="padding:10px;color:#fff;">${payload.requestedPlanName}</td></tr>
  </table>
  <div style="margin-top:16px;border:1px solid #1f2a3a;background:#0F1419;padding:12px;">
    <p style="margin:0 0 6px;color:#8aa1bf;font-size:11px;text-transform:uppercase;letter-spacing:1px;">User note</p>
    <p style="margin:0;color:#ddd;font-size:12px;white-space:pre-wrap;">${payload.note}</p>
  </div>
</div>`;

  const displayFrom = getSmtpFromAddress();

  await getTransporter().sendMail({
    from: `"Leeku Secure" <${displayFrom}>`,
    to: recipients.join(','),
    subject: `Quota request: ${payload.requesterUsername} -> ${payload.requestedPlanName}`,
    html,
    envelope: {
      from: displayFrom,
      to: recipients,
    },
  });

  console.log(`[email] Quota change request email sent to ${recipients.length} admin recipient(s).`);
}

// ──────────────────────────────────────────────────────────────
// Send account deletion confirmation email
// ──────────────────────────────────────────────────────────────

/**
 * Sends an account deletion confirmation email to the user.
 * The email contains a link that, when clicked, finalizes the deletion.
 * @param to Recipient email address
 * @param username The user's display name
 * @param token The deletion confirmation token
 */
export async function sendAccountDeletionEmail(to: string, username: string, token: string): Promise<void> {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const confirmUrl = `${appUrl}/api/users/me/delete-confirm?token=${encodeURIComponent(token)}`;

  const html = `
<div style="max-width:600px;margin:0 auto;font-family:monospace;background:#0A0E14;border:3px solid #FF007F;padding:32px;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="background:#FF007F;color:#fff;padding:4px 12px;font-size:10px;font-weight:900;letter-spacing:2px;">LEEKU_ACCOUNT_TERMINATION</span>
  </div>
  <h1 style="color:#FF007F;text-align:center;font-size:22px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">
    Account Deletion Request
  </h1>
  <p style="color:#ccc;text-align:center;font-size:12px;margin:0 0 24px;">
    Hello <strong style="color:#00F2FF;">${username}</strong>, we received a request to <strong style="color:#FF007F;">permanently delete</strong> your Leeku Secure account.<br/>
    This action will erase all your uploaded files, share links, and encryption keys — <strong>forever</strong>.
  </p>
  <div style="text-align:center;margin:32px 0;">
    <a href="${confirmUrl}" style="display:inline-block;background:#FF007F;color:#fff;padding:14px 36px;font-size:14px;font-weight:900;text-transform:uppercase;text-decoration:none;letter-spacing:2px;border:2px solid #00F2FF;">
      Confirm Account Deletion
    </a>
  </div>
  <p style="color:#555;text-align:center;font-size:10px;margin:24px 0 0;">
    If you did not request this, you can safely ignore this message — no changes will be made.<br/>
    This confirmation token expires in 1 hour.
  </p>
  <p style="color:#444;text-align:center;font-size:9px;">
    &mdash; The Leeku Secure team
  </p>
</div>`;

  const displayFrom = getSmtpFromAddress();

  await getTransporter().sendMail({
    from: `"Leeku Secure" <${displayFrom}>`,
    to,
    subject: 'Confirm account deletion — Leeku Secure',
    html,
    envelope: {
      from: displayFrom,
      to,
    },
  });

  console.log(`[email] Account deletion email sent to ${to} (envelope from: ${displayFrom})`);
}
