const AI_FEATURES_ENABLED = process.env.AI_SUGGESTIONS_ENABLED !== 'false';
const DEFAULT_ALLOWED_MODELS = ['gemma-3-27b-it'];
const MAX_PROMPT_CHARS = Number.parseInt(process.env.AI_MAX_PROMPT_CHARS || '12000', 10);
const MAX_OUTPUT_TOKENS_CAP = Number.parseInt(process.env.AI_MAX_OUTPUT_TOKENS || '512', 10);
const TEMP_MIN = 0;
const TEMP_MAX = 1;

const RATE_LIMIT_RPM = Number.parseInt(process.env.AI_RATE_LIMIT_RPM || '15', 10);
const RATE_LIMIT_RPD = Number.parseInt(process.env.AI_RATE_LIMIT_RPD || '500', 10);
const RATE_LIMIT_TTL_SECONDS = 172800;

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const inMemoryCounters = {
  perUser: new Map(),
};

const nowMs = () => Date.now();
const minuteBucket = (ts) => Math.floor(ts / 60000);
const dayBucket = (ts) => Math.floor(ts / 86400000);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getBearerToken = (req) => {
  const auth = req.headers.authorization || '';
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
};

const verifyGoogleToken = async (token) => {
  if (!token) return null;
  const url = `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  return data && data.email ? data : null;
};

const getAllowedModels = () => {
  const raw = process.env.AI_ALLOWED_MODELS;
  if (!raw) return DEFAULT_ALLOWED_MODELS;
  const models = raw.split(',').map((m) => m.trim()).filter(Boolean);
  return models.length > 0 ? models : DEFAULT_ALLOWED_MODELS;
};

const rateLimitHit = (res, message, retryAfterSeconds = 60) => {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ success: false, error: message });
};

const parseLimiterState = (raw) => {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed) return null;
    return {
      m: Number(parsed.m) || 0,
      mc: Number(parsed.mc) || 0,
      d: Number(parsed.d) || 0,
      dc: Number(parsed.dc) || 0,
    };
  } catch {
    return null;
  }
};

const buildLimiterState = (state) => JSON.stringify(state);

const hasUpstash = Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);

const upstashFetch = async (path) => {
  const response = await fetch(`${UPSTASH_REDIS_REST_URL}${path}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`Upstash error: ${response.status}`);
  }
  const data = await response.json();
  return data?.result;
};

const checkAndUpdateUserLimit = async (key, now) => {
  const minute = minuteBucket(now);
  const day = dayBucket(now);
  const stored = hasUpstash ? await upstashFetch(`/get/${encodeURIComponent(key)}`) : inMemoryCounters.perUser.get(key);
  const current = parseLimiterState(stored) || { m: minute, mc: 0, d: day, dc: 0 };
  const state = { ...current };

  if (state.m !== minute) {
    state.m = minute;
    state.mc = 0;
  }
  if (state.d !== day) {
    state.d = day;
    state.dc = 0;
  }

  if (state.mc + 1 > RATE_LIMIT_RPM) {
    return { allowed: false, message: 'Rate limit exceeded (per-user)', retryAfterSeconds: 60 };
  }
  if (state.dc + 1 > RATE_LIMIT_RPD) {
    return { allowed: false, message: 'Daily quota exceeded (per-user)', retryAfterSeconds: 3600 };
  }

  state.mc += 1;
  state.dc += 1;

  if (hasUpstash) {
    await upstashFetch(`/setex/${encodeURIComponent(key)}/${RATE_LIMIT_TTL_SECONDS}/${encodeURIComponent(buildLimiterState(state))}`);
  } else {
    inMemoryCounters.perUser.set(key, state);
  }

  return { allowed: true };
};

export default async function handler(req, res) {
  if (!AI_FEATURES_ENABLED) {
    res.status(503).json({ success: false, error: 'AI features are disabled' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  try {
    const accessToken = getBearerToken(req);
    const tokenInfo = await verifyGoogleToken(accessToken);
    if (!tokenInfo) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const userKey = tokenInfo.email || 'unknown-user';
    const now = nowMs();
    const limiterKey = `rl:user:${userKey}`;
    const limiter = await checkAndUpdateUserLimit(limiterKey, now);
    if (!limiter.allowed) {
      return rateLimitHit(res, limiter.message, limiter.retryAfterSeconds);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ success: false, error: 'Gemini API key not configured' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    const model = typeof body.model === 'string' ? body.model : (process.env.GEMINI_MODEL || 'gemma-3n-e4b-it');
    const temperature = Number.isFinite(body.temperature) ? body.temperature : 0.2;
    const maxOutputTokens = Number.isFinite(body.maxOutputTokens) ? body.maxOutputTokens : 512;

    if (!prompt) {
      res.status(400).json({ success: false, error: 'Missing prompt' });
      return;
    }

    if (prompt.length > MAX_PROMPT_CHARS) {
      res.status(400).json({ success: false, error: 'Prompt too large' });
      return;
    }

    const allowedModels = getAllowedModels();
    if (!allowedModels.includes(model)) {
      res.status(400).json({ success: false, error: 'Model not allowed' });
      return;
    }

    const safeTemperature = clamp(Number(temperature), TEMP_MIN, TEMP_MAX);
    const safeMaxOutputTokens = clamp(Number(maxOutputTokens), 1, MAX_OUTPUT_TOKENS_CAP);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: safeTemperature,
          maxOutputTokens: safeMaxOutputTokens,
        },
      }),
    });

    if (!response.ok) {
      res.status(response.status).json({ success: false, error: `Gemini request failed: ${response.status}` });
      return;
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const text = extractGeminiText(candidate);

    if (!text) {
      res.status(502).json({ success: false, error: 'Gemini response missing text' });
      return;
    }

    res.status(200).json({ success: true, text });
  } catch (error) {
    res.status(500).json({ success: false, error: error?.message || 'Gemini request failed' });
  }
}

function extractGeminiText(candidate) {
  if (!candidate) return '';
  const content = candidate.content || {};
  if (typeof content.text === 'string' && content.text.trim()) {
    return content.text;
  }
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const combined = parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  return combined.trim();
}
