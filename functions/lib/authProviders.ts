import type { Env } from './env';

export interface GoogleUserProfile {
  avatarUrl: string | null;
  displayName: string;
  email: string;
  providerUserId: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleUserInfoResponse {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  sub?: string;
}

function trimOrNull(value: string | undefined | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getGoogleClientId(env: Env): string {
  const clientId = trimOrNull(env.GOOGLE_CLIENT_ID);

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }

  return clientId;
}

function getGoogleClientSecret(env: Env): string {
  const clientSecret = trimOrNull(env.GOOGLE_CLIENT_SECRET);

  if (!clientSecret) {
    throw new Error('GOOGLE_CLIENT_SECRET is not configured');
  }

  return clientSecret;
}

function getResendApiKey(env: Env): string {
  const apiKey = trimOrNull(env.RESEND_API_KEY);

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  return apiKey;
}

function getAuthFromEmail(env: Env): string {
  const fromEmail = trimOrNull(env.AUTH_EMAIL_FROM);

  if (!fromEmail) {
    throw new Error('AUTH_EMAIL_FROM is not configured');
  }

  return fromEmail;
}

function getCreditClaimNotifyEmail(env: Env): string {
  const email = trimOrNull(env.CREDIT_CLAIM_NOTIFY_EMAIL);

  if (!email) {
    throw new Error('CREDIT_CLAIM_NOTIFY_EMAIL is not configured');
  }

  return email;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function exchangeGoogleCodeForProfile(
  env: Env,
  request: Request,
  code: string,
): Promise<GoogleUserProfile> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: getGoogleClientId(env),
      client_secret: getGoogleClientSecret(env),
      code,
      grant_type: 'authorization_code',
      redirect_uri: new URL('/api/auth/callback', request.url).toString(),
    }).toString(),
  });
  const tokenPayload = await parseJsonResponse<GoogleTokenResponse>(tokenResponse);

  if (!tokenResponse.ok || !tokenPayload?.access_token) {
    throw new Error(
      tokenPayload?.error_description ||
        tokenPayload?.error ||
        `Google token exchange failed with status ${tokenResponse.status}`,
    );
  }

  const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
    },
    method: 'GET',
  });
  const userInfoPayload = await parseJsonResponse<GoogleUserInfoResponse>(userInfoResponse);

  if (!userInfoResponse.ok) {
    throw new Error(`Google userinfo lookup failed with status ${userInfoResponse.status}`);
  }

  const email = trimOrNull(userInfoPayload?.email);
  const providerUserId = trimOrNull(userInfoPayload?.sub);

  if (!email || !providerUserId) {
    throw new Error('Google userinfo response is missing email or subject');
  }

  if (userInfoPayload?.email_verified === false) {
    throw new Error('Google account email is not verified');
  }

  return {
    avatarUrl: trimOrNull(userInfoPayload?.picture),
    displayName: trimOrNull(userInfoPayload?.name) ?? email,
    email,
    providerUserId,
  };
}

export async function sendMagicLinkEmail(
  env: Env,
  input: {
    callbackUrl: string;
    email: string;
    expiresAt: string;
  },
): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getResendApiKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getAuthFromEmail(env),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
          <h2 style="margin:0 0 12px">Sign in to MasterSelects</h2>
          <p style="margin:0 0 16px">Use the secure link below to continue.</p>
          <p style="margin:0 0 20px">
            <a href="${input.callbackUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">
              Sign in
            </a>
          </p>
          <p style="margin:0 0 8px;font-size:14px;color:#475569">This link expires at ${new Date(input.expiresAt).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'UTC',
          })} UTC.</p>
          <p style="margin:0;font-size:13px;color:#64748b">If you did not request this email, you can ignore it.</p>
        </div>
      `,
      subject: 'Your MasterSelects sign-in link',
      text: `Sign in to MasterSelects: ${input.callbackUrl}\n\nThis link expires at ${input.expiresAt}.`,
      to: [input.email],
    }),
  });
  const payload = (await parseJsonResponse<Record<string, unknown>>(response)) ?? {};

  if (!response.ok) {
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : typeof payload.error === 'string'
          ? payload.error
          : `Magic link email failed with status ${response.status}`;
    throw new Error(message);
  }
}

export async function sendFreeCreditClaimNotification(
  env: Env,
  input: {
    amount: number;
    claimId: string;
    claimedAt: string;
    claimedEmail: string;
  },
): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getResendApiKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getAuthFromEmail(env),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
          <h2 style="margin:0 0 12px">Free credits claimed</h2>
          <p style="margin:0 0 8px"><strong>${input.amount.toLocaleString()} credits</strong> were claimed by ${escapeHtml(input.claimedEmail)}.</p>
          <p style="margin:0;font-size:13px;color:#64748b">Claim ${escapeHtml(input.claimId)} at ${escapeHtml(input.claimedAt)}. Free-credit offers are now disarmed.</p>
        </div>
      `,
      subject: `MasterSelects: ${input.amount.toLocaleString()} free credits claimed`,
      text: `${input.amount} free credits were claimed by ${input.claimedEmail}. Claim ${input.claimId} at ${input.claimedAt}. Free-credit offers are now disarmed.`,
      to: [getCreditClaimNotifyEmail(env)],
    }),
  });
  const payload = (await parseJsonResponse<Record<string, unknown>>(response)) ?? {};

  if (!response.ok) {
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : typeof payload.error === 'string'
          ? payload.error
          : `Free credit claim notification failed with status ${response.status}`;
    throw new Error(message);
  }
}
