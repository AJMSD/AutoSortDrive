export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  try {
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens,
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
