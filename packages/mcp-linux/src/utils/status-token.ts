/**
 * Short-lived signed tokens for status page access (token-in-URL, same pattern as upload/download).
 * No server-side session store; secret from env.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_MIN = 60;

function getSecret(): string {
  const secret = process.env.MCP_LINUX_STATUS_TOKEN_SECRET?.trim();
  return secret || '';
}

function getTtlMin(): number {
  const v = process.env.MCP_LINUX_STATUS_TOKEN_TTL_MIN?.trim();
  if (!v) return DEFAULT_TTL_MIN;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MIN;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Buffer | null {
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
}

export interface StatusTokenPayload {
  email: string;
  exp: number;
}

function sign(payload: string): string {
  const secret = getSecret();
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return base64UrlEncode(hmac.digest());
}

/**
 * Creates a signed status token for the given email. Returns empty string if secret is not set.
 */
export function createToken(email: string): string {
  const secret = getSecret();
  if (!secret || typeof email !== 'string' || !email) return '';

  const exp = Math.floor(Date.now() / 1000) + getTtlMin() * 60;
  const payload = JSON.stringify({ email, exp });
  const payloadB64 = base64UrlEncode(Buffer.from(payload, 'utf8'));
  const signature = sign(payloadB64);
  return payloadB64 + '.' + signature;
}

/**
 * Verifies a status token and returns the payload or null if invalid/expired.
 */
export function verifyToken(token: string): StatusTokenPayload | null {
  const secret = getSecret();
  if (!secret || typeof token !== 'string' || !token) return null;

  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expectedSig = sign(payloadB64);

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  try {
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  } catch {
    return null;
  }

  const decoded = base64UrlDecode(payloadB64);
  if (!decoded) return null;

  let payload: StatusTokenPayload;
  try {
    payload = JSON.parse(decoded.toString('utf8')) as StatusTokenPayload;
  } catch {
    return null;
  }

  if (typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

function getStatusPageBaseUrl(): string {
  const PORT = parseInt(process.env.PORT || '3015', 10);

  const explicit = process.env.MCP_LINUX_STATUS_PAGE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const base =
    process.env.MCP_LINUX_UPLOAD_BASE_URL ||
    process.env.MCP_LINUX_DOWNLOAD_BASE_URL ||
    `http://localhost:${PORT}`;
  const normalized = base.replace(/\/+$/, '');
  return normalized + '/status';
}

/**
 * Returns the full status page URL including a signed token for the given email.
 * If secret is not set, returns the base URL without token (header-based auth only).
 */
export function getStatusPageUrlWithToken(email: string): string {
  const base = getStatusPageBaseUrl();
  const token = createToken(email);
  if (!token) return base;
  return base + (base.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
}
