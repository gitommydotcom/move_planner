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
