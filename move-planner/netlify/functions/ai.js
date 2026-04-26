// ═══════════════════════════════════════════════════════
//  Move Editorial Planner — Netlify Function v2 (ESM)
//  Storage: Netlify Blobs (built-in, zero config)
//  AI: Groq (free) o OpenRouter
//  Meta: Graph API proxy
// ═══════════════════════════════════════════════════════

import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: { message: 'Body JSON non valido.' } }, 400); }

  const { action = 'chat' } = body;

  // ── Blob Save ──
  if (action === 'blob-save') {
    if (!body.key) return json({ error: { message: 'key richiesta.' } }, 400);
    try {
      const store = getStore('move-planner');
      await store.setJSON(body.key, body.data);
      return json({ ok: true });
    } catch (e) {
      return json({ error: { message: 'Errore salvataggio: ' + e.message } }, 502);
    }
  }

  // ── Blob Load ──
  if (action === 'blob-load') {
    if (!body.key) return json({ error: { message: 'key richiesta.' } }, 400);
    try {
      const store = getStore('move-planner');
      const data = await store.get(body.key, { type: 'json' });
      if (data === null) return json({ error: { message: 'Nessun dato trovato per questo Codice Sync.' } }, 404);
      return json({ record: data });
    } catch (e) {
      return json({ error: { message: 'Errore caricamento: ' + e.message } }, 502);
    }
  }

  // ── AI Chat ──
  if (action === 'chat') {
    const provider = body.provider || 'groq';
    let apiKey, apiUrl, extraHeaders = {};

    if (provider === 'openrouter') {
      apiKey = process.env.OPENROUTER_API_KEY;
      apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
      extraHeaders = { 'HTTP-Referer': process.env.URL || '', 'X-Title': 'Move Editorial Planner' };
      if (!apiKey) return json({ error: { message: 'OPENROUTER_API_KEY non configurata su Netlify.' } }, 500);
    } else {
      apiKey = process.env.GROQ_API_KEY;
      apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
      if (!apiKey) return json({ error: { message: 'GROQ_API_KEY non configurata.' } }, 500);
    }

    const messages = [...(body.messages || [])];
    if (body.system) messages.unshift({ role: 'system', content: body.system });

    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
        body: JSON.stringify({
          model: body.model || (provider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct' : 'llama-3.3-70b-versatile'),
          max_tokens: Math.min(body.max_tokens || 4096, 8192),
          temperature: body.temperature || 0.7,
          messages,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) return json({ error: { message: data.error?.message || `${provider} HTTP ${resp.status}` } }, resp.status || 500);
      return json({ content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }], model: data.model, usage: data.usage });
    } catch (e) {
      return json({ error: { message: `Errore ${provider}: ${e.message}` } }, 502);
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

  // ── Config Check ──
  if (action === 'check-config') {
    return json({ groq: !!process.env.GROQ_API_KEY, openrouter: !!process.env.OPENROUTER_API_KEY, blobs: true });
  }

  return json({ error: { message: 'Azione non riconosciuta: ' + action } }, 400);
};
