import type { AppConfig } from '../../config/config.js';

/**
 * Production readiness checks (Phase 12C). Pure functions, used by `pnpm readiness` and tests.
 * Results never contain secret values — only whether a setting is acceptable.
 */
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** Configuration that loaded successfully can still be unsuitable for a live school. */
export function configChecks(config: AppConfig): Check[] {
  return [
    {
      name: 'environment',
      ok: config.isProduction,
      detail: config.isProduction
        ? 'NODE_ENV=production'
        : `NODE_ENV=${config.env} (not production)`,
    },
    {
      name: 'session secret',
      ok: !config.auth.sessionSecretIsEphemeral,
      detail: config.auth.sessionSecretIsEphemeral
        ? 'not set: a random secret per process signs everyone out on restart'
        : 'set (value not shown)',
    },
    {
      name: 'secure cookies + HSTS',
      ok: config.auth.cookieSecure && config.hsts,
      detail: config.auth.cookieSecure
        ? 'Secure, __Host- cookie; HSTS on'
        : 'cookies sent over plain HTTP',
    },
    {
      name: 'CORS origins',
      ok:
        config.corsOrigins.length > 0 && config.corsOrigins.every((o) => o.startsWith('https://')),
      detail: `${config.corsOrigins.length} exact origin(s)${
        config.corsOrigins.some((o) => !o.startsWith('https://')) ? ', some not https' : ''
      }`,
    },
    {
      name: 'reverse proxy',
      ok:
        !config.trustProxy ||
        config.vercel ||
        ['127.0.0.1', '::1', 'localhost'].includes(config.host),
      detail: config.trustProxy
        ? config.vercel
          ? "trusting X-Forwarded-* from Vercel's edge"
          : `trusting X-Forwarded-* from the local proxy (API on ${config.host})`
        : 'clients connect directly; forwarded headers ignored',
    },
    {
      name: 'database',
      ok: config.database.driver === 'postgres' || config.database.filename !== ':memory:',
      detail: config.database.driver === 'postgres' ? 'PostgreSQL' : 'SQLite file',
    },
  ];
}

export interface LiveResponse {
  status: number;
  headers: Headers;
  text(): Promise<string>;
}
export type Fetcher = (url: string) => Promise<LiveResponse>;

/** Checks against a running site (through the reverse proxy), e.g. https://school.example. */
export async function liveChecks(baseUrl: string, fetcher: Fetcher): Promise<Check[]> {
  const base = baseUrl.replace(/\/$/, '');
  const out: Check[] = [];
  const get = async (path: string) => {
    try {
      const res = await fetcher(`${base}${path}`);
      return { res, body: await res.text() };
    } catch (error) {
      return { res: null, body: error instanceof Error ? error.message : String(error) };
    }
  };

  const health = await get('/api/v1/health');
  const healthJson = health.res ? safeJson(health.body) : null;
  out.push({
    name: 'health endpoint',
    ok: health.res?.status === 200 && healthJson?.data?.database === 'up',
    detail: health.res ? `HTTP ${health.res.status}` : `unreachable: ${health.body}`,
  });
  if (health.res) {
    const keys = Object.keys(healthJson?.data ?? {})
      .sort()
      .join(',');
    out.push({
      name: 'health endpoint privacy',
      ok: keys === 'database,status,time',
      detail: `fields: ${keys || 'none'}`,
    });
    const h = health.res.headers;
    out.push({
      name: 'API security headers',
      ok:
        (h.get('strict-transport-security') ?? '').includes('max-age') &&
        (h.get('content-security-policy') ?? '').includes("default-src 'none'") &&
        h.get('x-content-type-options') === 'nosniff' &&
        h.get('cache-control') === 'no-store',
      detail: [
        'strict-transport-security',
        'content-security-policy',
        'x-content-type-options',
        'cache-control',
      ]
        .map((k) => `${k}: ${h.get(k) ? 'present' : 'MISSING'}`)
        .join('; '),
    });
  }

  const page = await get('/attendance');
  out.push({
    name: 'web app and client-side routes',
    ok: page.res?.status === 200 && page.body.includes('<div id="root">'),
    detail: page.res ? `HTTP ${page.res.status} for /attendance` : `unreachable: ${page.body}`,
  });
  if (page.res) {
    const h = page.res.headers;
    out.push({
      name: 'web security headers',
      ok:
        (h.get('strict-transport-security') ?? '').includes('max-age') &&
        (h.get('content-security-policy') ?? '').includes("frame-ancestors 'none'") &&
        h.get('x-content-type-options') === 'nosniff',
      detail: [
        'strict-transport-security',
        'content-security-policy',
        'x-content-type-options',
        'referrer-policy',
        'permissions-policy',
      ]
        .map((k) => `${k}: ${h.get(k) ? 'present' : 'MISSING'}`)
        .join('; '),
    });
  }

  const unknown = await get('/api/v1/readiness-probe-unknown-route');
  out.push({
    name: 'unknown API route',
    ok:
      unknown.res?.status === 404 && !/node_modules|\bat \w+ \(|\/home\/|stack/i.test(unknown.body),
    detail: unknown.res ? `HTTP ${unknown.res.status}, no internals in body` : 'unreachable',
  });

  // Only meaningful on the standard ports (443 → 80); a custom port has no plain-HTTP twin.
  const url = new URL(base);
  if (url.protocol === 'https:' && url.port === '') {
    const plain = await fetcher(`http://${url.host}/`)
      .then((r) => ({ status: r.status, location: r.headers.get('location') ?? '' }))
      .catch(() => null);
    out.push({
      name: 'HTTP redirects to HTTPS',
      ok:
        plain !== null &&
        plain.status >= 300 &&
        plain.status < 400 &&
        plain.location.startsWith('https://'),
      detail: plain
        ? `HTTP ${plain.status} → ${plain.location || '(no location)'}`
        : 'port 80 unreachable',
    });
  }
  return out;
}

function safeJson(text: string): { data?: Record<string, unknown> } | null {
  try {
    return JSON.parse(text) as { data?: Record<string, unknown> };
  } catch {
    return null;
  }
}
