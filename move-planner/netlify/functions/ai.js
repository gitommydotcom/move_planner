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

// Image: HF Inference Providers (router) — provider must be enabled on the user's HF account.
// Cascade: Nebius (cheap/fast) → Fal-ai → Together → legacy serverless inference.
const IMAGE_PROVIDERS = [
  { name: 'nebius',   url: 'https://router.huggingface.co/nebius/v1/images/generations',   model: 'black-forest-labs/flux-schnell',        kind: 'openai' },
  { name: 'together', url: 'https://router.huggingface.co/together/v1/images/generations', model: 'black-forest-labs/FLUX.1-schnell-Free', kind: 'openai' },
  { name: 'fal-ai',   url: 'https://router.huggingface.co/fal-ai/fal-ai/flux/schnell',     model: null,                                    kind: 'fal'    },
  { name: 'hf-legacy', url: HF_INFERENCE + '/stabilityai/stable-diffusion-xl-base-1.0',    model: null,                                    kind: 'binary' },
];

const DEFAULT_VIDEO_MODEL = 'Lightricks/LTX-Video';

async function fetchToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('fetch image url ' + r.status);
  const ctype = r.headers.get('content-type') || 'image/png';
  const buf = await r.arrayBuffer();
  return { contentType: ctype, base64: Buffer.from(buf).toString('base64') };
}

async function tryImageProvider(p, prompt, apiKey) {
  try {
    if (p.kind === 'openai') {
      const resp = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: p.model, prompt, n: 1, response_format: 'b64_json', size: '1024x1024' }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return { error: `${p.name} HTTP ${resp.status}: ${data?.error?.message || data?.error || data?.message || resp.statusText}` };
      const item = data?.data?.[0];
      if (item?.b64_json) return { contentType: 'image/png', base64: item.b64_json };
      if (item?.url) {
        const f = await fetchToBase64(item.url);
        return f;
      }
      return { error: `${p.name}: risposta inattesa` };
    }
    if (p.kind === 'fal') {
      const resp = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ prompt, image_size: 'square_hd', num_inference_steps: 4 }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return { error: `${p.name} HTTP ${resp.status}: ${data?.error || data?.message || resp.statusText}` };
      const url = data?.images?.[0]?.url || data?.image?.url;
      if (!url) return { error: `${p.name}: nessuna immagine` };
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
        let msg = `${p.name} HTTP ${resp.status}`;
        try { const j = await resp.json(); msg += ': ' + (j.error || j.message || ''); } catch {}
        return { error: msg };
      }
      const buf = await resp.arrayBuffer();
      return { contentType: ctype, base64: Buffer.from(buf).toString('base64') };
    }
  } catch (e) {
    return { error: `${p.name}: ${e.message}` };
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

  // ── Text-to-Image (Hugging Face Inference Providers, with cascade) ──
  if (action === 'image') {
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) return json({ error: { message: 'HUGGINGFACE_API_KEY non configurata su Netlify.' } }, 500);
    const prompt = (body.prompt || '').toString().trim();
    if (!prompt) return json({ error: { message: 'prompt richiesto.' } }, 400);
    const errors = [];
    for (const p of IMAGE_PROVIDERS) {
      const r = await tryImageProvider(p, prompt, apiKey);
      if (!r.error) return json({ dataUrl: `data:${r.contentType};base64,${r.base64}`, provider: p.name });
      errors.push(r.error);
    }
    return json({ error: { message: 'Nessun provider HF disponibile. Attiva un provider (Nebius/Together/Fal-ai) sul tuo account HuggingFace → Inference Providers. Dettagli: ' + errors.join(' | ') } }, 502);
  }

  // ── Text-to-Video (Hugging Face) ──
  if (action === 'video') {
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) return json({ error: { message: 'HUGGINGFACE_API_KEY non configurata su Netlify.' } }, 500);
    const prompt = (body.prompt || '').toString().trim();
    if (!prompt) return json({ error: { message: 'prompt richiesto.' } }, 400);
    const model = body.model || DEFAULT_VIDEO_MODEL;
    const r = await hfBinary(model, { inputs: prompt }, apiKey);
    if (r.error) return json({ error: { message: r.error } }, r.status || 502);
    return json({ dataUrl: `data:${r.contentType};base64,${r.base64}`, model });
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
