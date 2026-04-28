// ═══════════════════════════════════════════════════════
//  Move Editorial Planner — Netlify Function v3 (ESM)
//  AI:   Hugging Face Inference (chat completions API)
//  Auth: verifies Supabase JWT (chat + meta require login)
//  Meta: Graph API proxy
// ═══════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const HF_BASE = 'https://router.huggingface.co/v1/chat/completions';
const DEFAULT_HF_MODEL = 'meta-llama/Llama-3.3-70B-Instruct';
const HF_INFERENCE = 'https://api-inference.huggingface.co/models';

// Image models — HF Inference Providers routing. Each entry maps a UI choice
// to a concrete provider+endpoint+payload shape. The backend tries the chosen
// model first, then falls back through IMAGE_MODELS_FALLBACK.
const IMAGE_MODELS = {
  'flux-schnell-nebius':   { label: 'FLUX.1 Schnell (Nebius, veloce)',     url: 'https://router.huggingface.co/nebius/v1/images/generations',   model: 'black-forest-labs/flux-schnell',        kind: 'openai' },
  'flux-schnell-together': { label: 'FLUX.1 Schnell (Together, free)',     url: 'https://router.huggingface.co/together/v1/images/generations', model: 'black-forest-labs/FLUX.1-schnell-Free', kind: 'openai' },
  'flux-schnell-fal':      { label: 'FLUX.1 Schnell (Fal.ai, qualità)',    url: 'https://router.huggingface.co/fal-ai/fal-ai/flux/schnell',     model: null,                                    kind: 'fal'    },
  'flux-dev-fal':          { label: 'FLUX.1 Dev (Fal.ai, max qualità)',    url: 'https://router.huggingface.co/fal-ai/fal-ai/flux/dev',         model: null,                                    kind: 'fal'    },
  'flux-dev-nebius':       { label: 'FLUX.1 Dev (Nebius)',                 url: 'https://router.huggingface.co/nebius/v1/images/generations',   model: 'black-forest-labs/flux-dev',            kind: 'openai' },
  'sd35-large-fal':        { label: 'Stable Diffusion 3.5 Large (Fal.ai)', url: 'https://router.huggingface.co/fal-ai/fal-ai/stable-diffusion-v35-large', model: null,                          kind: 'fal'    },
  'sdxl-together':         { label: 'Stable Diffusion XL (Together)',      url: 'https://router.huggingface.co/together/v1/images/generations', model: 'stabilityai/stable-diffusion-xl-base-1.0', kind: 'openai' },
  'sdxl-legacy':           { label: 'Stable Diffusion XL (HF legacy)',     url: HF_INFERENCE + '/stabilityai/stable-diffusion-xl-base-1.0',     model: null,                                    kind: 'binary' },
};
const IMAGE_MODELS_FALLBACK = ['flux-schnell-nebius', 'flux-schnell-together', 'flux-schnell-fal', 'sdxl-legacy'];

async function fetchToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('fetch image url ' + r.status);
  const ctype = r.headers.get('content-type') || 'image/png';
  const buf = await r.arrayBuffer();
  return { contentType: ctype, base64: Buffer.from(buf).toString('base64') };
}

async function tryImageProvider(p, prompt, apiKey) {
  if (!p) return { error: 'modello sconosciuto' };
  try {
    if (p.kind === 'openai') {
      const resp = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: p.model, prompt, n: 1, response_format: 'b64_json', size: '1024x1024' }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return { error: `${p.label || p.kind} HTTP ${resp.status}: ${data?.error?.message || data?.error || data?.message || resp.statusText}` };
      const item = data?.data?.[0];
      if (item?.b64_json) return { contentType: 'image/png', base64: item.b64_json };
      if (item?.url) {
        const f = await fetchToBase64(item.url);
        return f;
      }
      return { error: `${p.label || p.kind}: risposta inattesa` };
    }
    if (p.kind === 'fal') {
      const resp = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ prompt, image_size: 'square_hd' }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return { error: `${p.label || p.kind} HTTP ${resp.status}: ${data?.error || data?.message || resp.statusText}` };
      const url = data?.images?.[0]?.url || data?.image?.url;
      if (!url) return { error: `${p.label || p.kind}: nessuna immagine` };
      return await fetchToBase64(url);
    }
    if (p.kind === 'binary') {
      const resp = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'x-wait-for-model': 'true' },
        body: JSON.stringify({ inputs: prompt }),
      });
      const ctype = resp.headers.get('content-type') || '';
      if (!resp.ok || ctype.includes('application/json')) {
        let msg = `${p.label || p.kind} HTTP ${resp.status}`;
        try { const j = await resp.json(); msg += ': ' + (j.error || j.message || ''); } catch {}
        return { error: msg };
      }
      const buf = await resp.arrayBuffer();
      return { contentType: ctype, base64: Buffer.from(buf).toString('base64') };
    }
  } catch (e) {
    return { error: `${p.label || p.kind}: ${e.message}` };
  }
  return { error: 'unknown provider' };
}

async function hfBinary(model, payload, apiKey) {
  const resp = await fetch(`${HF_INFERENCE}/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'x-wait-for-model': 'true',
    },
    body: JSON.stringify(payload),
  });
  const ctype = resp.headers.get('content-type') || '';
  if (!resp.ok || ctype.includes('application/json')) {
    let msg = `Hugging Face HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      msg = j.error || j.message || msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch {}
    return { error: msg, status: resp.status };
  }
  const buf = await resp.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  return { contentType: ctype, base64: b64 };
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

async function verifySupabaseJWT(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? u : null;
  } catch {
    return null;
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: { message: 'Body JSON non valido.' } }, 400); }

  const { action = 'chat' } = body;

  // ── Config check (public) ──
  if (action === 'check-config') {
    return json({
      huggingface: !!process.env.HUGGINGFACE_API_KEY,
      supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    });
  }

  // Everything below requires a logged-in user.
  const user = await verifySupabaseJWT(req);
  if (!user) return json({ error: { message: 'Autenticazione richiesta. Effettua il login.' } }, 401);

  // ── AI Chat (Hugging Face) ──
  if (action === 'chat') {
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) return json({ error: { message: 'HUGGINGFACE_API_KEY non configurata su Netlify.' } }, 500);

    const messages = [...(body.messages || [])];
    if (body.system) messages.unshift({ role: 'system', content: body.system });

    try {
      const resp = await fetch(HF_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: body.model || DEFAULT_HF_MODEL,
          messages,
          max_tokens: Math.min(body.max_tokens || 4096, 8192),
          temperature: body.temperature ?? 0.7,
          stream: false,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        const msg = data.error?.message || data.error || `Hugging Face HTTP ${resp.status}`;
        return json({ error: { message: typeof msg === 'string' ? msg : JSON.stringify(msg) } }, resp.status || 500);
      }
      const text = data.choices?.[0]?.message?.content || '';
      return json({ content: [{ type: 'text', text }], model: data.model, usage: data.usage });
    } catch (e) {
      return json({ error: { message: 'Errore Hugging Face: ' + e.message } }, 502);
    }
  }

  // ── List available image models (public-ish — needs auth like everything below) ──
  if (action === 'image-models') {
    return json({ models: Object.entries(IMAGE_MODELS).map(([id, m]) => ({ id, label: m.label })) });
  }

  // ── Text-to-Image (Hugging Face Inference Providers, with cascade) ──
  if (action === 'image') {
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) return json({ error: { message: 'HUGGINGFACE_API_KEY non configurata su Netlify.' } }, 500);
    const prompt = (body.prompt || '').toString().trim();
    if (!prompt) return json({ error: { message: 'prompt richiesto.' } }, 400);

    const chosen = body.imageModel && IMAGE_MODELS[body.imageModel] ? body.imageModel : null;
    const order = [];
    if (chosen) order.push(chosen);
    for (const id of IMAGE_MODELS_FALLBACK) if (!order.includes(id)) order.push(id);

    const errors = [];
    for (const id of order) {
      const r = await tryImageProvider(IMAGE_MODELS[id], prompt, apiKey);
      if (!r.error) return json({ dataUrl: `data:${r.contentType};base64,${r.base64}`, model: id });
      errors.push(`[${id}] ${r.error}`);
    }
    return json({ error: { message: 'Tutti i provider hanno fallito. Verifica i provider HF Inference attivati sul tuo account. Dettagli: ' + errors.join(' | ') } }, 502);
  }

  // ── Meta Graph API Proxy ──
  if (action === 'meta') {
    const { access_token: token, endpoint } = body;
    if (!token || !endpoint) return json({ error: { message: 'access_token e endpoint richiesti.' } }, 400);
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      const resp = await fetch(`https://graph.facebook.com/v21.0${endpoint}${sep}access_token=${encodeURIComponent(token)}`);
      const data = await resp.json();
      return json(data, resp.ok ? 200 : resp.status);
    } catch (e) {
      return json({ error: { message: 'Errore Meta API: ' + e.message } }, 502);
    }
  }

  return json({ error: { message: 'Azione non riconosciuta: ' + action } }, 400);
};
