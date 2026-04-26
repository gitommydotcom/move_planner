# Move — Editorial Planner

Piano editoriale AI per social media. Deploy su Netlify.

## Setup Rapido

### 1. Deploy su Netlify
- Carica lo zip su [Netlify Drop](https://app.netlify.com/drop) oppure collega un repo Git

### 2. Variabili d'ambiente (Netlify → Site settings → Environment variables)

| Variabile | Obbligatoria | Come ottenerla |
|-----------|-------------|----------------|
| `GROQ_API_KEY` | ✅ Sì | [console.groq.com](https://console.groq.com) → API Keys → Create (gratuito) |
| `JSONBIN_API_KEY` | ⚡ Consigliata | [jsonbin.io](https://jsonbin.io) → Login → API Keys → Copy Master Key |

### 3. Integrazioni Opzionali (configurabili nelle Impostazioni dell'app)

| Servizio | Come configurare |
|----------|-----------------|
| **Meta Business** | [developers.facebook.com](https://developers.facebook.com) → App → Token con permessi: `pages_read_engagement, instagram_basic, instagram_manage_insights, ads_read` |
| **Canva** | [canva.com/developers](https://www.canva.com/developers) → Integrazione → OAuth con permessi: `design:content:read, design:content:write, asset:read, asset:write` |

### 4. Accesso
- Password predefinita: configurata internamente
- Modificabile nelle Impostazioni dell'app

## Funzionalità

- 🤖 AI gratuita (Groq/Llama 3.3 70B)
- 📊 Dashboard con statistiche e suggerimenti AI
- 👥 Schede cliente complete (contatti, social, Meta Business, orari, brand)
- 📅 Generatore piano editoriale multi-step con:
  - Multi-selezione piattaforme, obiettivi, formati, pilastri, CTA
  - Descrizione visual per ogni post
  - Template personalizzabile
- 📤 Export: CSV (importabile in Canva Bulk Create), HTML, Copia tutto
- ☁️ Sync cloud con JSONBin
- 🔒 Protezione con password
- 📱 Responsive mobile
