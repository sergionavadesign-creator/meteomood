// ══════════════════════════════════════════════════════════════
// citydata.js — Netlify Function
// Aggrega mood per città da: news RSS, Reddit, Open-Meteo, utenti
// Algoritmo NLP keyword-based potenziato, cache 6h su Supabase
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

// ── DIZIONARIO SENTIMENT MULTILINGUA ──────────────────────────
const SENTIMENT = {
  // Molto positivo (+15)
  veryPositive: [
    // IT
    'festival','concerto','record','boom','crescita','vittoria','sole','estate',
    'apertura','inaugurazione','celebrazione','successo','campione','olimpiadi',
    'rinascita','ottimismo','ripresa','accordo','pace','investimento',
    // EN
    'festival','concert','record','boom','growth','victory','sunny','summer',
    'opening','celebration','award','winner','champion','olympics','recovery',
    'agreement','peace','investment','thriving','flourishing','breakthrough',
    // ES/FR/DE
    'crecimiento','victoire','feier','erfolg','wachstum',
  ],
  // Positivo (+8)
  positive: [
    // IT
    'buono','bello','miglioramento','ottimo','tranquillo','soleggiato','caldo',
    'turismo','cultura','evento','sport','musica','arte','mostra','fiera',
    // EN
    'good','great','improve','better','warm','tourism','culture','event',
    'sport','music','art','fair','show','positive','progress','innovation',
    'launch','collaboration','partnership','funding','sustainability',
    // Misc
    'bien','gut','bon',
  ],
  // Neutro (0)
  neutral: [
    'notizia','update','annuncio','comunicato','dichiarazione',
    'news','announcement','statement','report','meeting','conference',
  ],
  // Negativo (-10)
  negative: [
    // IT
    'sciopero','protesta','incidente','maltempo','allerta','crisi','chiusura',
    'emergenza','tensione','difficoltà','rallentamento','calo','pericolo',
    'inquinamento','traffico','caos','ritardo','problema','critica',
    // EN
    'strike','protest','incident','storm','alert','crisis','closure',
    'emergency','tension','slowdown','decline','danger','pollution',
    'traffic','chaos','delay','problem','criticism','concern','warning',
    'dispute','controversy','lawsuit','fine','penalty','sanction',
    // Misc
    'huelga','grève','streik',
  ],
  // Molto negativo (-18)
  veryNegative: [
    // IT
    'disastro','tragedia','morte','attacco','violenza','terrore','alluvione',
    'incendio','omicidio','crollo','esplosione','guerra','conflitto',
    // EN
    'disaster','tragedy','death','attack','violence','terror','flood',
    'fire','murder','collapse','explosion','war','conflict','massacre',
    'shooting','bombing','earthquake','hurricane','pandemic','outbreak',
    // Misc
    'desastre','katastrophe','tragédie',
  ],
  // Freddo/distante (-6)
  cold: [
    // IT
    'freddo','neve','gelo','isolamento','vuoto','silenzio','abbandono','solitudine',
    // EN
    'cold','snow','ice','isolated','lonely','empty','abandoned','silent','dark','fog',
  ],
};

// ── CALCOLO SENTIMENT PESATO ──────────────────────────────────
function calcSentiment(text, weight = 1) {
  if (!text) return 0;
  const t = text.toLowerCase();
  let score = 0;
  SENTIMENT.veryPositive.forEach(w => { if (t.includes(w)) score += 15; });
  SENTIMENT.positive.forEach(w => { if (t.includes(w)) score += 8; });
  SENTIMENT.negative.forEach(w => { if (t.includes(w)) score -= 10; });
  SENTIMENT.veryNegative.forEach(w => { if (t.includes(w)) score -= 18; });
  SENTIMENT.cold.forEach(w => { if (t.includes(w)) score -= 6; });
  return Math.max(-100, Math.min(100, score)) * weight;
}

// Analizza lista di testi, restituisce score medio + campioni
function analyzeTexts(texts, maxItems = 20) {
  if (!texts.length) return { score: 0, count: 0 };
  const scores = texts.slice(0, maxItems).map(t => calcSentiment(t));
  const total = scores.reduce((a, b) => a + b, 0);
  return {
    score: total / scores.length,
    count: scores.length,
    positive: scores.filter(s => s > 0).length,
    negative: scores.filter(s => s < 0).length,
  };
}

// ── MOOD DAL SCORE ────────────────────────────────────────────
function scoreToMood(externalScore, userScore, userWeight) {
  const combined = externalScore * (1 - userWeight) + userScore * userWeight;
  if (combined > 55) return 'rainbow';
  if (combined > 20) return 'sunny';
  if (combined > -15) return 'cloudy';
  if (combined > -45) return 'rainy';
  if (combined < -65) return 'stormy';
  return 'snowy';
}

const MOOD_VALS = {rainbow:100, sunny:70, cloudy:0, rainy:-30, snowy:-60, stormy:-80};

// ── FETCH HELPERS ─────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, ms = 5000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {...opts, signal: ctrl.signal});
    clearTimeout(id);
    return res;
  } catch(e) {
    clearTimeout(id);
    throw e;
  }
}

// ── NEWS RSS (Google News) ────────────────────────────────────
async function fetchNews(city) {
  const feeds = [
    `https://news.google.com/rss/search?q=${encodeURIComponent(city)}+news&hl=it&gl=IT&ceid=IT:it`,
    `https://news.google.com/rss/search?q=${encodeURIComponent(city)}&hl=en&gl=US&ceid=US:en`,
  ];

  let allTexts = [], items = [];

  for (const url of feeds) {
    try {
      const r = await fetchWithTimeout(url, {}, 5000);
      if (!r.ok) continue;
      const xml = await r.text();

      // Estrai titoli e descrizioni
      const titleMatches = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)];
      const descMatches = [...xml.matchAll(/<description><!\[CDATA\[(.*?)\]\]><\/description>/g)];
      const plainTitles = [...xml.matchAll(/<title>((?!.*CDATA).*?)<\/title>/g)];

      const texts = [
        ...titleMatches.map(m => m[1]),
        ...plainTitles.map(m => m[1]),
        ...descMatches.map(m => m[1].replace(/<[^>]+>/g, '')),
      ].filter(t => t && !t.includes('Google News') && t.length > 5).slice(0, 15);

      allTexts.push(...texts);
      items.push(...texts.slice(0, 3).map(t => t.substring(0, 70)));
    } catch(e) {}
  }

  const analysis = analyzeTexts(allTexts);
  return {score: analysis.score, items: items.slice(0, 4)};
}

// ── REDDIT ────────────────────────────────────────────────────
async function fetchReddit(city) {
  // Prova vari subreddit
  const citySlug = city.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/à|á/g, 'a').replace(/è|é/g, 'e').replace(/ì|í/g, 'i')
    .replace(/ò|ó/g, 'o').replace(/ù|ú/g, 'u')
    .replace(/ã|â/g, 'a').replace(/ñ/g, 'n');

  const subs = [citySlug, city.toLowerCase().replace(/\s+/g, '_'), city.split(' ')[0].toLowerCase()];
  let allTexts = [], posts = [];

  for (const sub of [...new Set(subs)]) {
    try {
      const r = await fetchWithTimeout(
        `https://www.reddit.com/r/${sub}/hot.json?limit=20`,
        {headers: {'User-Agent': 'MeteoMood/2.0 (mood aggregator)'}},
        5000
      );
      if (!r.ok) continue;
      const data = await r.json();
      const children = data?.data?.children || [];
      if (!children.length) continue;

      children.forEach(p => {
        const text = (p.data.title || '') + ' ' + (p.data.selftext?.substring(0, 200) || '');
        allTexts.push(text);
        if (p.data.title) posts.push(p.data.title.substring(0, 55));
      });
      break; // Primo subreddit valido trovato
    } catch(e) {}
  }

  // Fallback: cerca per città in r/worldnews o r/europe
  if (!allTexts.length) {
    try {
      const r = await fetchWithTimeout(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(city)}&sort=hot&limit=15&t=day`,
        {headers: {'User-Agent': 'MeteoMood/2.0'}},
        5000
      );
      if (r.ok) {
        const data = await r.json();
        (data?.data?.children || []).forEach(p => {
          allTexts.push(p.data.title || '');
          posts.push((p.data.title || '').substring(0, 55));
        });
      }
    } catch(e) {}
  }

  const analysis = analyzeTexts(allTexts);
  return {score: analysis.score, items: posts.slice(0, 3)};
}

// ── METEO (Open-Meteo) ────────────────────────────────────────
async function fetchWeather(lat, lng) {
  try {
    const r = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=weathercode,temperature_2m,precipitation,windspeed_10m&timezone=auto`,
      {},
      5000
    );
    if (!r.ok) return {score: 0, desc: ''};
    const d = await r.json();
    const code = d?.current?.weathercode ?? 0;
    const temp = d?.current?.temperature_2m ?? 15;
    const precip = d?.current?.precipitation ?? 0;
    const wind = d?.current?.windspeed_10m ?? 0;

    let score = 0, desc = '';

    // WMO weather codes
    if (code === 0) { score = 35; desc = `☀️ ${temp}°C soleggiato`; }
    else if (code <= 2) { score = 20; desc = `🌤️ ${temp}°C parzialmente nuvoloso`; }
    else if (code <= 3) { score = 0; desc = `⛅ ${temp}°C nuvoloso`; }
    else if (code <= 48) { score = -5; desc = `🌫️ ${temp}°C nebbia`; }
    else if (code <= 57) { score = -15; desc = `🌦️ ${temp}°C pioggerella`; }
    else if (code <= 67) { score = -25; desc = `🌧️ ${temp}°C pioggia`; }
    else if (code <= 77) { score = -35; desc = `❄️ ${temp}°C neve`; }
    else if (code <= 82) { score = -20; desc = `🌦️ ${temp}°C rovesci`; }
    else if (code <= 99) { score = -50; desc = `⛈️ ${temp}°C temporale`; }

    // Correzioni temperatura
    if (temp > 28) score += 10;
    else if (temp > 20) score += 5;
    else if (temp < 5) score -= 10;
    else if (temp < 0) score -= 20;

    // Vento forte
    if (wind > 50) score -= 10;

    return {score: Math.max(-100, Math.min(100, score)), desc};
  } catch(e) {
    return {score: 0, desc: ''};
  }
}

// ── CHECKIN UTENTI (Supabase) ─────────────────────────────────
async function fetchUserCheckins(lat, lng) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return {score:0, count:0, weight:0};
  try {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const delta = 0.09; // ~10km
    const url = `${SUPABASE_URL}/rest/v1/checkins?lat=gte.${lat-delta}&lat=lte.${lat+delta}&lng=gte.${lng-delta}&lng=lte.${lng+delta}&created_at=gte.${sixHoursAgo}&select=mood`;
    const r = await fetchWithTimeout(url, {
      headers: {'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`}
    }, 5000);
    if (!r.ok) return {score:0, count:0, weight:0};
    const checkins = await r.json();
    if (!Array.isArray(checkins) || !checkins.length) return {score:0, count:0, weight:0};

    const score = checkins.reduce((s, c) => s + (MOOD_VALS[c.mood] || 0), 0) / checkins.length;
    const count = checkins.length;
    let weight = 0;
    if (count >= 200) weight = 0.85;
    else if (count >= 100) weight = 0.75;
    else if (count >= 25) weight = 0.60;
    else if (count >= 10) weight = 0.40;
    else if (count >= 3) weight = 0.25;
    else if (count >= 1) weight = 0.10;

    return {score, count, weight};
  } catch(e) {
    return {score:0, count:0, weight:0};
  }
}

// ── CACHE SUPABASE ────────────────────────────────────────────
async function getCached(city) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const r = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/city_cache?city=eq.${encodeURIComponent(city)}&updated_at=gte.${sixHoursAgo}&select=*&limit=1`,
      {headers: {'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`}},
      4000
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (data && data.length > 0) ? {...data[0].data, cached: true} : null;
  } catch(e) { return null; }
}

async function setCache(city, result) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/city_cache`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({city, data: result, updated_at: new Date().toISOString()}),
    }, 4000);
  } catch(e) {}
}

// ── HANDLER PRINCIPALE ────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return {statusCode:200, headers, body:''};

  const params = event.queryStringParameters || {};
  const city = params.city || 'Milano';
  const lat = parseFloat(params.lat || '45.46');
  const lng = parseFloat(params.lng || '9.19');

  // 1. Controlla cache
  const cached = await getCached(city);
  if (cached) return {statusCode:200, headers, body: JSON.stringify(cached)};

  // 2. Fetch tutte le sorgenti in parallelo
  const [news, reddit, weather, users] = await Promise.all([
    fetchNews(city),
    fetchReddit(city),
    fetchWeather(lat, lng),
    fetchUserCheckins(lat, lng),
  ]);

  // 3. Pesi dinamici (gli utenti scalano via via)
  const userWeight = users.weight;
  const extWeight = 1 - userWeight;
  const newsWeight   = extWeight * 0.45;
  const redditWeight = extWeight * 0.35;
  const weatherWeight = extWeight * 0.20;

  const externalScore =
    news.score    * newsWeight +
    reddit.score  * redditWeight +
    weather.score * weatherWeight;

  const mood = scoreToMood(externalScore, users.score, userWeight);

  // 4. Score 0-100 per UI
  const rawScore = externalScore * (1 - userWeight) + users.score * userWeight;
  const score = Math.round(50 + rawScore * 0.35);

  const result = {
    city, mood, score,
    user_checkins: users.count,
    user_weight: Math.round(userWeight * 100),
    weather: weather.desc,
    sources: {
      news: news.items,
      reddit: reddit.items,
      users: users.count,
    },
    debug: {
      newsScore: Math.round(news.score),
      redditScore: Math.round(reddit.score),
      weatherScore: Math.round(weather.score),
      userScore: Math.round(users.score),
      externalScore: Math.round(externalScore),
      combined: Math.round(rawScore),
    },
    updated_at: new Date().toISOString(),
  };

  // 5. Salva cache
  await setCache(city, result);

  return {statusCode:200, headers, body: JSON.stringify(result)};
};
