# MeteoMood — Deploy Guide

## Struttura file
```
meteomood/
├── index.html                      # App completa
├── manifest.json                   # PWA manifest
├── sw.js                           # Service worker v2
├── netlify.toml                    # Config Netlify
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── netlify/
    └── functions/
        ├── citydata.js             # Analisi news+Reddit+meteo+utenti
        ├── zonaldata.js            # Mood per zona GPS
        └── mood.js                 # Salva check-in
```

## Deploy su Netlify (via GitHub)

### 1. Crea repo GitHub
```bash
git init
git add .
git commit -m "MeteoMood v2 — initial release"
git remote add origin https://github.com/TUO_USERNAME/meteomood.git
git push -u origin main
```

### 2. Collega a Netlify
- Vai su netlify.com → Add new site → Import from Git
- Seleziona il repo
- Build command: (lascia vuoto)
- Publish directory: `.`
- Clicca Deploy

### 3. Variabili ambiente (OBBLIGATORIO)
In Netlify → Site settings → Environment variables:
```
SUPABASE_URL     = https://rcyxndnpsjaznztlnqcl.supabase.co
SUPABASE_SECRET_KEY = (service_role key da Supabase → Project Settings → API)
```
⚠️ Usa la SECRET key (service_role), non quella publishable!

### 4. Tabelle Supabase necessarie
Esegui in Supabase SQL Editor:

```sql
-- Tabella check-in
CREATE TABLE IF NOT EXISTS checkins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  mood text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  user_id text DEFAULT 'anonymous',
  created_at timestamptz DEFAULT now()
);

-- Indici per query geografiche
CREATE INDEX IF NOT EXISTS idx_checkins_lat ON checkins(lat);
CREATE INDEX IF NOT EXISTS idx_checkins_lng ON checkins(lng);
CREATE INDEX IF NOT EXISTS idx_checkins_created ON checkins(created_at DESC);

-- Cache città
CREATE TABLE IF NOT EXISTS city_cache (
  city text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Row Level Security (opzionale ma consigliato)
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE city_cache ENABLE ROW LEVEL SECURITY;

-- Policy: tutti possono inserire, nessuno può leggere dati altrui
CREATE POLICY "insert_checkins" ON checkins FOR INSERT WITH CHECK (true);
CREATE POLICY "read_city_cache" ON city_cache FOR ALL USING (true);
```

## Costi operativi
- Netlify: €0 (piano gratuito — 125k Function invocations/mese)
- Supabase: €0 (piano gratuito — 50.000 righe, 500MB)
- Open-Meteo: €0 (gratuito senza limiti)
- Google News RSS: €0 (gratuito)
- Reddit API: €0 (accesso pubblico)
- **Totale: €0/mese**

## Note importanti
- Le Netlify Functions RICHIEDONO deploy via GitHub (non funzionano con ZIP manuale)
- Il SW v2 è compatibile con iOS Safari, Chrome, Firefox
- Pinch-to-zoom sulla mappa funziona su mobile
- Le label delle città appaiono solo quando si zooma
