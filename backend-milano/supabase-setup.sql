-- ══════════════════════════════════════════════════════════════
-- MeteoMood — SQL setup per Supabase
-- Esegui in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- Tabella check-in utenti
CREATE TABLE IF NOT EXISTS checkins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  mood text NOT NULL CHECK (mood IN ('sunny','rainbow','cloudy','rainy','stormy','snowy')),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  user_id text DEFAULT 'anonymous',
  created_at timestamptz DEFAULT now()
);

-- Indici per query geografiche veloci
CREATE INDEX IF NOT EXISTS idx_checkins_lat ON checkins(lat);
CREATE INDEX IF NOT EXISTS idx_checkins_lng ON checkins(lng);
CREATE INDEX IF NOT EXISTS idx_checkins_created ON checkins(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_geo ON checkins(lat, lng, created_at DESC);

-- Cache dati città (aggiornata ogni ora dal backend)
CREATE TABLE IF NOT EXISTS city_cache (
  city text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Storico sentiment (per analytics e ML futuro)
CREATE TABLE IF NOT EXISTS sentiment_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  city text NOT NULL,
  mood text NOT NULL,
  score integer,
  reddit_score integer,
  bluesky_score integer,
  news_score integer,
  weather_score integer,
  sample_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sentiment_city ON sentiment_history(city, created_at DESC);

-- RLS (Row Level Security)
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE city_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentiment_history ENABLE ROW LEVEL SECURITY;

-- Policy: chiunque può inserire check-in, nessuno può leggere dati altrui
CREATE POLICY "public_insert_checkins" ON checkins
  FOR INSERT WITH CHECK (true);

CREATE POLICY "read_own_checkins" ON checkins
  FOR SELECT USING (true); -- in produzione: auth.uid() = user_id

-- Cache leggibile da tutti (dati pubblici aggregati)
CREATE POLICY "public_read_cache" ON city_cache
  FOR SELECT USING (true);

CREATE POLICY "backend_write_cache" ON city_cache
  FOR ALL USING (true); -- il backend usa service_role key

-- Storico solo backend
CREATE POLICY "backend_sentiment" ON sentiment_history
  FOR ALL USING (true);
