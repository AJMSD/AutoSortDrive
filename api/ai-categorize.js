const AI_FEATURES_ENABLED = process.env.AI_SUGGESTIONS_ENABLED !== 'false';
const DEFAULT_ALLOWED_MODELS = ['gemma-3n-e4b-it'];
const MAX_PROMPT_CHARS = Number.parseInt(process.env.AI_MAX_PROMPT_CHARS || '12000', 10);
const MAX_OUTPUT_TOKENS_CAP = Number.parseInt(process.env.AI_MAX_OUTPUT_TOKENS || '512', 10);
const TEMP_MIN = 0;
const TEMP_MAX = 1;

const RATE_LIMIT_RPM = Number.parseInt(process.env.AI_RATE_LIMIT_RPM || '15', 10);
const RATE_LIMIT_RPD = Number.parseInt(process.env.AI_RATE_LIMIT_RPD || '500', 10);
const GLOBAL_DAILY_LIMIT = Number.parseInt(process.env.AI_GLOBAL_DAILY_LIMIT || '12000', 10);
const GLOBAL_SOFT_LIMIT = Number.parseInt(process.env.AI_GLOBAL_SOFT_LIMIT || '9600', 10);

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const inMemoryCounters = {
  perMinute: new Map(),
  perDay: new Map(),
  globalDay: new Map(),
};

const nowMs = () => Date.now();
const minuteBucket = (ts) => Math.floor(ts / 60000);
const dayBucket = (ts) => Math.floor(ts / 86400000);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
};

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

const checkAndIncrement = (map, key, bucket, limit) => {
  const entry = map.get(key);
  if (entry && entry.bucket === bucket) {
    if (entry.count >= limit) {
      return { allowed: false, count: entry.count };
    }
    entry.count += 1;
    map.set(key, entry);
    return { allowed: true, count: entry.count };
  }
  map.set(key, { bucket, count: 1 });
  return { allowed: true, count: 1 };
};

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

const kvIncrWithTtl = async (key, ttlSeconds) => {
  const count = await upstashFetch(`/incr/${encodeURIComponent(key)}`);
  if (count === 1 && ttlSeconds) {
    await upstashFetch(`/expire/${encodeURIComponent(key)}/${ttlSeconds}`);
  }
  return count;
};

const checkAndIncrementAsync = async (map, key, bucket, limit, ttlSeconds) => {
  if (hasUpstash) {
    const count = await kvIncrWithTtl(key, ttlSeconds);
    return { allowed: count <= limit, count };
  }
  return checkAndIncrement(map, key, bucket, limit);
};

const recordMetric = async (name) => {
  if (!hasUpstash) return;
  try {
    const day = dayBucket(Date.now());
    await kvIncrWithTtl(`metric:${name}:${day}`, 172800);
  } catch {}
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
    const ipKey = getClientIp(req);
    const now = nowMs();
    const minute = minuteBucket(now);
    const day = dayBucket(now);

    const perUserMinute = await checkAndIncrementAsync(inMemoryCounters.perMinute, `user:${userKey}:${minute}`, minute, RATE_LIMIT_RPM, 120);
    if (!perUserMinute.allowed) {
      await recordMetric('ai_429_user');
      return rateLimitHit(res, 'Rate limit exceeded (per-user)', 60);
    }

    const perIpMinute = await checkAndIncrementAsync(inMemoryCounters.perMinute, `ip:${ipKey}:${minute}`, minute, RATE_LIMIT_RPM * 2, 120);
    if (!perIpMinute.allowed) {
      await recordMetric('ai_429_ip');
      return rateLimitHit(res, 'Rate limit exceeded (per-ip)', 60);
    }

    const perUserDay = await checkAndIncrementAsync(inMemoryCounters.perDay, `user:${userKey}:${day}`, day, RATE_LIMIT_RPD, 172800);
    if (!perUserDay.allowed) {
      await recordMetric('ai_429_user_day');
      return rateLimitHit(res, 'Daily quota exceeded (per-user)', 3600);
    }

    const globalDay = await checkAndIncrementAsync(inMemoryCounters.globalDay, `global:${day}`, day, GLOBAL_DAILY_LIMIT, 172800);
    if (!globalDay.allowed) {
      await recordMetric('ai_429_global');
      return rateLimitHit(res, 'Daily quota exceeded (global)', 3600);
    }

    if (globalDay.count >= GLOBAL_SOFT_LIMIT) {
      res.setHeader('X-AI-Budget-Warning', 'true');
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

    await recordMetric('ai_success');
    res.status(200).json({ success: true, text });
  } catch (error) {
    await recordMetric('ai_error');
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
