# MeteoMood Backend Milano — Deploy su Render.com

## Cosa fa
Server Node.js che ogni ora:
1. Legge Reddit (r/milano, r/italy, r/italianproblems)
2. Legge Bluesky (post pubblici con #milano)
3. Legge GNews (notizie locali Milano)
4. Legge Open-Meteo (meteo attuale)
5. Calcola il mood combinato
6. Salva su Supabase → l'app lo legge automaticamente

## Deploy su Render.com (GRATUITO)

### 1. Crea account su render.com

### 2. New → Web Service → Deploy from GitHub
- Collega il tuo repo GitHub
- Root directory: `backend-milano`
- Runtime: Node
- Build command: (lascia vuoto)
- Start command: `node server.js`
- Plan: **Free**

### 3. Variabili ambiente su Render
In Environment → Add Environment Variable:
```
SUPABASE_URL = https://rcyxndnpsjaznztlnqcl.supabase.co
SUPABASE_SECRET_KEY = (la tua service_role key)
GNEWS_API_KEY = 3f698a8adc162c3fbb3a024bea9e368f
PORT = 3000
```

### 4. Setup Supabase
Esegui `supabase-setup.sql` in Supabase → SQL Editor

### 5. Verifica
Vai su `https://tuo-servizio.onrender.com/health` → deve rispondere `{"status":"ok"}`
Vai su `https://tuo-servizio.onrender.com/analyze` → forza un'analisi immediata

## Endpoints
- `GET /` — info servizio
- `GET /health` — health check
- `GET /analyze` — forza analisi immediata

## Note
- Il piano gratuito di Render va in sleep dopo 15 min di inattività
- Per tenerlo sveglio: usa UptimeRobot (gratuito) che pinga /health ogni 5 min
- Con il piano gratuito hai 750 ore/mese = praticamente sempre attivo
