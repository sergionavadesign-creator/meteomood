// ══════════════════════════════════════════════════════════════
// MeteoMood Backend — Milano Pilot
// Server Node.js per Render.com
// Legge: Reddit, Bluesky, GNews, Open-Meteo
// Salva sentiment orario su Supabase
// ══════════════════════════════════════════════════════════════

const https = require('https');
const http = require('http');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const GNEWS_KEY = process.env.GNEWS_API_KEY;

// ── CITY CONFIG ───────────────────────────────────────────────
const MILANO = {
  name: 'Milano',
  lat: 45.46,
  lng: 9.19,
  // Reddit subreddits da monitorare
  subreddits: ['milano', 'italy', 'italianproblems', 'italy_travel'],
  // Keyword per filtrare post pertinenti
  keywords: ['milano', 'milan', 'lombardia', 'duomo', 'navigli', 'brera', 'città', 'zona'],
  // Bluesky search terms
  bskyTerms: ['Milano', 'milan', '#milano', '#milan'],
};

// ── SENTIMENT ENGINE ──────────────────────────────────────────
const SENTIMENT = {
  veryPositive: ['festival','concerto','record','boom','crescita','vittoria','celebrazione','successo','olimpiadi','rinascita','ottimismo','apertura','amore','bellissimo','fantastico','meraviglioso','eccellente','perfetto','felice','felicità','gioia','entusiasmo','festival','concert','record','growth','victory','celebration','award','winner','recovery','amazing','wonderful','excellent','perfect','happy','happiness','joy','love','beautiful','great','awesome'],
  positive: ['buono','bello','bravo','miglioramento','ottimo','tranquillo','soleggiato','caldo','turismo','cultura','evento','sport','musica','arte','mostra','divertente','piacevole','interessante','good','better','warm','tourism','culture','event','music','art','fun','nice','enjoyable','interesting','positive','progress'],
  negative: ['sciopero','protesta','incidente','maltempo','allerta','crisi','chiusura','emergenza','tensione','difficoltà','calo','pericolo','inquinamento','traffico','caos','ritardo','problema','brutto','orribile','triste','paura','ansia','stress','strike','protest','crisis','emergency','tension','problem','ugly','terrible','sad','fear','anxiety','stress','concern','warning','bad','worse','awful'],
  veryNegative: ['disastro','tragedia','morte','attacco','violenza','incendio','omicidio','esplosione','conflitto','disaster','tragedy','death','attack','violence','fire','murder','explosion','conflict','collapse','catastrophe','devastation'],
  cold: ['freddo','neve','gelo','isolamento','vuoto','solitudine','cold','snow','ice','isolated','lonely','empty','dark','silent','abandoned'],
};

function calcSentiment(text) {
  if (!text || text.length < 5) return null;
  const t = text.toLowerCase();
  let score = 0, hits = 0;
  SENTIMENT.veryPositive.forEach(w => { if (t.includes(w)) { score += 15; hits++; } });
  SENTIMENT.positive.forEach(w => { if (t.includes(w)) { score += 8; hits++; } });
  SENTIMENT.negative.forEach(w => { if (t.includes(w)) { score -= 10; hits++; } });
  SENTIMENT.veryNegative.forEach(w => { if (t.includes(w)) { score -= 18; hits++; } });
  SENTIMENT.cold.forEach(w => { if (t.includes(w)) { score -= 6; hits++; } });
  if (hits === 0) return null; // testo neutro, non conta
  return Math.max(-100, Math.min(100, score));
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
function fetchURL(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'MeteoMood/1.0 (mood aggregator; contact@meteomood.app)',
        'Accept': 'application/json',
        ...options.headers,
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (options.timeout) req.setTimeout(options.timeout, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// ── REDDIT ────────────────────────────────────────────────────
async function fetchReddit(city) {
  const texts = [];
  const samples = [];

  for (const sub of city.subreddits) {
    try {
      const res = await fetchURL(
        `https://www.reddit.com/r/${sub}/hot.json?limit=25`,
        { timeout: 8000 }
      );
      if (res.status !== 200) continue;
      const posts = res.body?.data?.children || [];

      for (const post of posts) {
        const text = (post.data.title || '') + ' ' + (post.data.selftext?.substring(0, 300) || '');
        // Filtra solo post pertinenti a Milano
        const isRelevant = city.keywords.some(k => text.toLowerCase().includes(k)) || sub === 'milano';
        if (isRelevant) {
          texts.push(text);
          if (post.data.title) samples.push(post.data.title.substring(0, 60));
        }
      }

      // Fetch anche i commenti dei post più upvotati
      const topPost = posts.sort((a,b) => b.data.score - a.data.score)[0];
      if (topPost) {
        try {
          const commRes = await fetchURL(
            `https://www.reddit.com/r/${sub}/comments/${topPost.data.id}.json?limit=20`,
            { timeout: 6000 }
          );
          if (commRes.status === 200 && Array.isArray(commRes.body)) {
            const comments = commRes.body[1]?.data?.children || [];
            comments.forEach(c => {
              if (c.data.body && c.data.body.length > 20) texts.push(c.data.body.substring(0, 200));
            });
          }
        } catch(e) {}
      }
    } catch(e) {
      console.log(`Reddit r/${sub}: ${e.message}`);
    }
  }

  if (!texts.length) return { score: 0, count: 0, samples: [] };
  const scores = texts.map(t => calcSentiment(t)).filter(s => s !== null);
  return {
    score: scores.length ? scores.reduce((a,b) => a+b, 0) / scores.length : 0,
    count: texts.length,
    samples: samples.slice(0, 5),
  };
}

// ── BLUESKY ───────────────────────────────────────────────────
async function fetchBluesky(city) {
  const texts = [];
  const samples = [];

  for (const term of city.bskyTerms.slice(0, 2)) {
    try {
      const res = await fetchURL(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=20&lang=it`,
        { timeout: 7000 }
      );
      if (res.status !== 200) continue;
      const posts = res.body?.posts || [];
      posts.forEach(p => {
        const text = p.record?.text || '';
        if (text.length > 15) {
          texts.push(text);
          samples.push(text.substring(0, 60));
        }
      });
    } catch(e) {
      console.log(`Bluesky ${term}: ${e.message}`);
    }
  }

  if (!texts.length) return { score: 0, count: 0, samples: [] };
  const scores = texts.map(t => calcSentiment(t)).filter(s => s !== null);
  return {
    score: scores.length ? scores.reduce((a,b) => a+b, 0) / scores.length : 0,
    count: texts.length,
    samples: samples.slice(0, 3),
  };
}

// ── GNEWS ─────────────────────────────────────────────────────
async function fetchGNews(city) {
  if (!GNEWS_KEY) return { score: 0, count: 0, samples: [] };
  try {
    const res = await fetchURL(
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(city.name)}&lang=it&max=10&token=${GNEWS_KEY}`,
      { timeout: 8000 }
    );
    if (res.status !== 200) return { score: 0, count: 0, samples: [] };
    const articles = res.body?.articles || [];
    const texts = articles.map(a => (a.title||'') + ' ' + (a.description||''));
    const samples = articles.map(a => (a.title||'').substring(0, 65));
    const scores = texts.map(t => calcSentiment(t)).filter(s => s !== null);
    return {
      score: scores.length ? scores.reduce((a,b) => a+b, 0) / scores.length : 0,
      count: articles.length,
      samples: samples.slice(0, 4),
    };
  } catch(e) {
    return { score: 0, count: 0, samples: [] };
  }
}

// ── OPEN-METEO ────────────────────────────────────────────────
async function fetchWeather(lat, lng) {
  try {
    const res = await fetchURL(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=weathercode,temperature_2m,precipitation,windspeed_10m&timezone=auto`,
      { timeout: 6000 }
    );
    if (res.status !== 200) return { score: 0, desc: '' };
    const d = res.body?.current;
    if (!d) return { score: 0, desc: '' };
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
    else if (code<=82) { score=-20; desc=`🌦️ ${temp}°C rovesci`; }
    else               { score=-50; desc=`⛈️ ${temp}°C temporale`; }
    if (temp>28) score+=10; else if (temp>20) score+=5;
    else if (temp<0) score-=20; else if (temp<5) score-=10;
    if (wind>50) score-=10;
    return { score: Math.max(-100, Math.min(100, score)), desc };
  } catch(e) { return { score: 0, desc: '' }; }
}

// ── SUPABASE SAVE ─────────────────────────────────────────────
async function saveToSupabase(city, result) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    // Salva in city_cache (usato dall'app)
    await fetchURL(`${SUPABASE_URL}/rest/v1/city_cache`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ city: city.name, data: result, updated_at: new Date().toISOString() }),
    });

    // Salva storico sentiment (per analytics futuri)
    await fetchURL(`${SUPABASE_URL}/rest/v1/sentiment_history`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        city: city.name,
        mood: result.mood,
        score: result.score,
        reddit_score: result.debug?.redditScore,
        bluesky_score: result.debug?.bskyScore,
        news_score: result.debug?.newsScore,
        weather_score: result.debug?.weatherScore,
        sample_count: result.debug?.totalSamples,
        created_at: new Date().toISOString(),
      }),
    });

    console.log(`✅ Saved ${city.name}: ${result.mood} (score: ${result.score})`);
  } catch(e) {
    console.error(`❌ Supabase save error: ${e.message}`);
  }
}

// ── ANALISI PRINCIPALE ────────────────────────────────────────
async function analyzeMilano() {
  console.log(`\n🔍 [${new Date().toISOString()}] Analisi Milano...`);

  const [reddit, bluesky, news, weather] = await Promise.all([
    fetchReddit(MILANO),
    fetchBluesky(MILANO),
    fetchGNews(MILANO),
    fetchWeather(MILANO.lat, MILANO.lng),
  ]);

  console.log(`  Reddit: ${reddit.count} testi, score ${reddit.score.toFixed(1)}`);
  console.log(`  Bluesky: ${bluesky.count} testi, score ${bluesky.score.toFixed(1)}`);
  console.log(`  GNews: ${news.count} articoli, score ${news.score.toFixed(1)}`);
  console.log(`  Meteo: ${weather.desc}, score ${weather.score}`);

  // Pesi delle sorgenti
  // Reddit ha il peso maggiore (commenti reali, geolocalizzati)
  // Bluesky crescerà con la piattaforma
  // GNews dà contesto news locale
  // Meteo influenza ma non domina
  const totalSamples = reddit.count + bluesky.count + news.count;

  let weights = { reddit: 0.40, bluesky: 0.20, news: 0.25, weather: 0.15 };

  // Aggiusta pesi in base alla disponibilità dati
  if (reddit.count === 0) { weights.bluesky += 0.20; weights.news += 0.10; weights.weather += 0.10; weights.reddit = 0; }
  if (bluesky.count === 0) { weights.reddit += 0.10; weights.news += 0.10; weights.bluesky = 0; }
  if (news.count === 0) { weights.reddit += 0.15; weights.bluesky += 0.10; weights.news = 0; }

  // Normalizza
  const total = Object.values(weights).reduce((a,b) => a+b, 0);
  Object.keys(weights).forEach(k => weights[k] /= total);

  const combinedScore =
    reddit.score * weights.reddit +
    bluesky.score * weights.bluesky +
    news.score * weights.news +
    weather.score * weights.weather;

  const mood = scoreToMood(combinedScore);
  const score = Math.round(50 + combinedScore * 0.35);

  // Costruisce summary
  const allSamples = [...reddit.samples, ...bluesky.samples, ...news.samples].slice(0, 6);

  const result = {
    city: MILANO.name,
    mood,
    score,
    user_checkins: 0, // verrà aggiornato dalla Function
    user_weight: 0,
    weather: weather.desc,
    sources: {
      news: news.samples.slice(0, 3),
      reddit: reddit.samples.slice(0, 2),
      bluesky: bluesky.samples.slice(0, 2),
      total_texts: totalSamples,
    },
    debug: {
      redditScore: Math.round(reddit.score),
      bskyScore: Math.round(bluesky.score),
      newsScore: Math.round(news.score),
      weatherScore: Math.round(weather.score),
      combined: Math.round(combinedScore),
      weights,
      totalSamples,
    },
    updated_at: new Date().toISOString(),
    source: 'backend-pilot',
  };

  console.log(`  → Mood: ${mood} (combined: ${combinedScore.toFixed(1)}, score: ${score})`);
  await saveToSupabase(MILANO, result);
  return result;
}

// ── HTTP SERVER (richiesto da Render) ────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  } else if (req.url === '/analyze') {
    analyzeMilano()
      .then(result => { res.writeHead(200); res.end(JSON.stringify(result)); })
      .catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
  } else if (req.url === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({
      name: 'MeteoMood Backend — Milano Pilot',
      version: '1.0',
      nextRun: new Date(Date.now() + nextRunIn).toISOString(),
    }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌦️ MeteoMood Backend running on port ${PORT}`));

// ── SCHEDULER ────────────────────────────────────────────────
let nextRunIn = 0;

async function runLoop() {
  await analyzeMilano();
  const ONE_HOUR = 60 * 60 * 1000;
  nextRunIn = ONE_HOUR;
  console.log(`⏰ Prossima analisi tra 1 ora`);
  setTimeout(runLoop, ONE_HOUR);
}

// Avvia subito
runLoop().catch(e => console.error('Loop error:', e));
