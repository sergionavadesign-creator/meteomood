// ══════════════════════════════════════════════════════════════
// MeteoMood Backend — Milano Pilot v2
// Server Node.js per Render.com
// Legge: Reddit, Bluesky, GNews, Open-Meteo ogni ora
// Salva sentiment su Supabase → app lo legge automaticamente
// ══════════════════════════════════════════════════════════════

const https = require('https');
const http = require('http');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const GNEWS_KEY = process.env.GNEWS_API_KEY;

const MILANO = {
  name: 'Milano',
  lat: 45.46,
  lng: 9.19,
  subreddits: ['milano', 'italy', 'italianproblems'],
  keywords: ['milano', 'milan', 'lombardia', 'duomo', 'navigli', 'brera', 'isola', 'porta romana'],
  bskyTerms: ['Milano', '#milano', 'Milan Italy'],
};

// ── SENTIMENT ─────────────────────────────────────────────────
const SENT = {
  vp: ['festival','concerto','vittoria','celebrazione','successo','amore','bellissimo','fantastico','meraviglioso','felice','felicità','gioia','entusiasmo','record','boom','crescita','award','winner','amazing','wonderful','excellent','perfect','happy','joy','love','beautiful','great','awesome','thriving'],
  p:  ['buono','bello','bravo','miglioramento','ottimo','tranquillo','soleggiato','caldo','turismo','cultura','evento','sport','musica','arte','divertente','piacevole','good','better','warm','tourism','culture','event','music','art','fun','nice','enjoyable','positive','progress'],
  n:  ['sciopero','protesta','incidente','maltempo','allerta','crisi','chiusura','emergenza','tensione','difficoltà','caos','ritardo','problema','brutto','triste','paura','ansia','stress','strike','protest','crisis','emergency','tension','problem','terrible','sad','fear','anxiety','stress','concern','bad','worse','awful'],
  vn: ['disastro','tragedia','morte','attacco','violenza','incendio','omicidio','esplosione','conflitto','disaster','tragedy','death','attack','violence','fire','murder','explosion','conflict'],
  c:  ['freddo','neve','gelo','isolamento','vuoto','solitudine','cold','snow','ice','isolated','lonely','empty','dark'],
};

function calcSentiment(text) {
  if (!text || text.length < 5) return null;
  const t = text.toLowerCase();
  let score = 0, hits = 0;
  SENT.vp.forEach(w => { if (t.includes(w)) { score += 15; hits++; } });
  SENT.p.forEach(w =>  { if (t.includes(w)) { score += 8;  hits++; } });
  SENT.n.forEach(w =>  { if (t.includes(w)) { score -= 10; hits++; } });
  SENT.vn.forEach(w => { if (t.includes(w)) { score -= 18; hits++; } });
  SENT.c.forEach(w =>  { if (t.includes(w)) { score -= 6;  hits++; } });
  return hits === 0 ? null : Math.max(-100, Math.min(100, score));
}

function scoreToMood(score) {
  if (score > 55) return 'rainbow';
  if (score > 20) return 'sunny';
  if (score > -15) return 'cloudy';
  if (score > -45) return 'rainy';
  if (score < -65) return 'stormy';
  return 'snowy';
}

// ── HTTP HELPER ───────────────────────────────────────────────
function fetchURL(url, opts = {}, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        method: opts.method || 'GET',
        headers: {
          'User-Agent': 'MeteoMood/2.0 (opensource mood aggregator)',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
          ...opts.headers,
        },
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch(e) { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', e => resolve({ status: 0, body: null, error: e.message }));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, body: null, error: 'timeout' }); });
      req.end();
    } catch(e) {
      resolve({ status: 0, body: null, error: e.message });
    }
  });
}

// ── REDDIT ────────────────────────────────────────────────────
async function fetchReddit() {
  const texts = [], samples = [];
  for (const sub of MILANO.subreddits) {
    const res = await fetchURL(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`);
    if (res.status !== 200 || !res.body?.data) {
      console.log(`  Reddit r/${sub}: status ${res.status}`);
      continue;
    }
    const posts = res.body.data.children || [];
    console.log(`  Reddit r/${sub}: ${posts.length} posts`);
    for (const p of posts) {
      const text = (p.data.title || '') + ' ' + (p.data.selftext || '').substring(0, 200);
      const relevant = sub === 'milano' || MILANO.keywords.some(k => text.toLowerCase().includes(k));
      if (relevant) {
        texts.push(text);
        if (p.data.title) samples.push(p.data.title.substring(0, 60));
      }
    }
    // Piccola pausa tra richieste
    await new Promise(r => setTimeout(r, 500));
  }
  const scores = texts.map(t => calcSentiment(t)).filter(s => s !== null);
  const avg = scores.length ? scores.reduce((a,b) => a+b,0) / scores.length : 0;
  console.log(`  Reddit totale: ${texts.length} testi, score ${avg.toFixed(1)}`);
  return { score: avg, count: texts.length, samples: samples.slice(0,5) };
}

// ── BLUESKY ───────────────────────────────────────────────────
async function fetchBluesky() {
  const texts = [], samples = [];
  for (const term of MILANO.bskyTerms.slice(0,2)) {
    const res = await fetchURL(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=20&lang=it`
    );
    if (res.status !== 200 || !res.body?.posts) {
      console.log(`  Bluesky "${term}": status ${res.status}`);
      continue;
    }
    const posts = res.body.posts || [];
    console.log(`  Bluesky "${term}": ${posts.length} posts`);
    posts.forEach(p => {
      const text = p.record?.text || '';
      if (text.length > 15) { texts.push(text); samples.push(text.substring(0, 60)); }
    });
  }
  const scores = texts.map(t => calcSentiment(t)).filter(s => s !== null);
  const avg = scores.length ? scores.reduce((a,b) => a+b,0) / scores.length : 0;
  console.log(`  Bluesky totale: ${texts.length} testi, score ${avg.toFixed(1)}`);
  return { score: avg, count: texts.length, samples: samples.slice(0,3) };
}

// ── GNEWS ─────────────────────────────────────────────────────
async function fetchGNews() {
  if (!GNEWS_KEY) { console.log('  GNews: no key'); return { score: 0, count: 0, samples: [] }; }
  const res = await fetchURL(
    `https://gnews.io/api/v4/search?q=${encodeURIComponent(MILANO.name)}&lang=it&max=10&token=${GNEWS_KEY}`
  );
  if (res.status !== 200 || !res.body?.articles) {
    console.log(`  GNews: status ${res.status}`);
    return { score: 0, count: 0, samples: [] };
  }
  const articles = res.body.articles || [];
  console.log(`  GNews: ${articles.length} articoli`);
  const texts = articles.map(a => (a.title||'') + ' ' + (a.description||''));
  const samples = articles.map(a => (a.title||'').substring(0,65));
  const scores = texts.map(t => calcSentiment(t)).filter(s => s !== null);
  const avg = scores.length ? scores.reduce((a,b) => a+b,0) / scores.length : 0;
  console.log(`  GNews score: ${avg.toFixed(1)}`);
  return { score: avg, count: articles.length, samples: samples.slice(0,4) };
}

// ── METEO ─────────────────────────────────────────────────────
async function fetchWeather() {
  const res = await fetchURL(
    `https://api.open-meteo.com/v1/forecast?latitude=${MILANO.lat}&longitude=${MILANO.lng}&current=weathercode,temperature_2m,precipitation,windspeed_10m&timezone=Europe/Rome`
  );
  if (res.status !== 200 || !res.body?.current) {
    console.log(`  Meteo: status ${res.status}`);
    return { score: 0, desc: '' };
  }
  const d = res.body.current;
  const code = d.weathercode ?? 0;
  const temp = d.temperature_2m ?? 15;
  const wind = d.windspeed_10m ?? 0;
  let score = 0, desc = '';
  if (code===0)      { score=35;  desc=`☀️ ${temp}°C soleggiato`; }
  else if (code<=2)  { score=20;  desc=`🌤️ ${temp}°C parz. nuvoloso`; }
  else if (code<=3)  { score=0;   desc=`⛅ ${temp}°C nuvoloso`; }
  else if (code<=48) { score=-5;  desc=`🌫️ ${temp}°C nebbia`; }
  else if (code<=57) { score=-15; desc=`🌦️ ${temp}°C pioggerella`; }
  else if (code<=67) { score=-25; desc=`🌧️ ${temp}°C pioggia`; }
  else if (code<=77) { score=-35; desc=`❄️ ${temp}°C neve`; }
  else               { score=-50; desc=`⛈️ ${temp}°C temporale`; }
  if (temp>28) score+=10; else if (temp>20) score+=5;
  else if (temp<0) score-=20; else if (temp<5) score-=10;
  if (wind>50) score-=10;
  score = Math.max(-100, Math.min(100, score));
  console.log(`  Meteo: ${desc}, score ${score}`);
  return { score, desc };
}

// ── SUPABASE ──────────────────────────────────────────────────
async function saveToSupabase(result) {
  if (!SUPABASE_URL || !SUPABASE_KEY) { console.log('  Supabase: no config'); return; }
  
  const body = JSON.stringify({ city: MILANO.name, data: result, updated_at: new Date().toISOString() });
  
  const res = await fetchURL(`${SUPABASE_URL}/rest/v1/city_cache`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Prefer': 'resolution=merge-duplicates',
    },
  });

  // Workaround: usa fetch nativo se disponibile
  if (typeof globalThis.fetch !== 'undefined') {
    try {
      await globalThis.fetch(`${SUPABASE_URL}/rest/v1/city_cache`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body,
      });
      console.log(`  ✅ Salvato su Supabase: ${result.mood} (score ${result.score})`);
      return;
    } catch(e) {}
  }

  console.log(`  Supabase status: ${res.status}`);
  if (res.status >= 200 && res.status < 300) {
    console.log(`  ✅ Salvato su Supabase: ${result.mood} (score ${result.score})`);
  } else {
    console.log(`  ❌ Supabase error: ${JSON.stringify(res.body)}`);
  }
}

// ── ANALISI PRINCIPALE ────────────────────────────────────────
async function analyzeMilano() {
  console.log(`\n🔍 [${new Date().toISOString()}] Analisi Milano...`);
  
  const [reddit, bluesky, news, weather] = await Promise.all([
    fetchReddit(),
    fetchBluesky(),
    fetchGNews(),
    fetchWeather(),
  ]);

  const totalSamples = reddit.count + bluesky.count + news.count;
  
  // Pesi adattivi
  let w = { reddit: 0.40, bluesky: 0.20, news: 0.25, weather: 0.15 };
  if (reddit.count === 0)  { w.bluesky += 0.20; w.news += 0.10; w.weather += 0.10; w.reddit = 0; }
  if (bluesky.count === 0) { w.reddit += 0.10; w.news += 0.10; w.bluesky = 0; }
  if (news.count === 0)    { w.reddit += 0.15; w.bluesky += 0.10; w.news = 0; }
  const tot = Object.values(w).reduce((a,b) => a+b, 0);
  Object.keys(w).forEach(k => w[k] /= tot);

  const combined = reddit.score*w.reddit + bluesky.score*w.bluesky + news.score*w.news + weather.score*w.weather;
  const mood = scoreToMood(combined);
  const score = Math.round(50 + combined * 0.35);

  console.log(`  → Combined: ${combined.toFixed(1)}, Mood: ${mood}, Score: ${score}`);

  const result = {
    city: MILANO.name,
    mood,
    score,
    user_checkins: 0,
    user_weight: 0,
    weather: weather.desc,
    sources: {
      news: news.samples.slice(0,3),
      reddit: reddit.samples.slice(0,2),
      bluesky: bluesky.samples.slice(0,2),
      total_texts: totalSamples,
    },
    debug: {
      redditScore: Math.round(reddit.score),
      bskyScore: Math.round(bluesky.score),
      newsScore: Math.round(news.score),
      weatherScore: Math.round(weather.score),
      combined: Math.round(combined),
      weights: w,
      totalSamples,
    },
    updated_at: new Date().toISOString(),
    source: 'backend-pilot-v2',
  };

  await saveToSupabase(result);
  return result;
}

// ── HTTP SERVER ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()), version: '2.0' }));
  } else if (req.url === '/analyze') {
    analyzeMilano()
      .then(r => { res.writeHead(200); res.end(JSON.stringify(r)); })
      .catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
  } else {
    res.writeHead(200);
    res.end(JSON.stringify({ name: 'MeteoMood Backend Milano', version: '2.0', status: 'running' }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌦️ MeteoMood Backend v2 running on port ${PORT}`));

// ── SCHEDULER ────────────────────────────────────────────────
async function runLoop() {
  try { await analyzeMilano(); } catch(e) { console.error('Analisi error:', e.message); }
  setTimeout(runLoop, 60 * 60 * 1000); // ogni ora
}
runLoop();
