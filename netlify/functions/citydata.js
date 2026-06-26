// ══════════════════════════════════════════════════════════════
// citydata.js — Netlify Function
// Sorgenti: GNews API + Open-Meteo + Supabase checkins
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const GNEWS_KEY = process.env.GNEWS_API_KEY;

// ── SENTIMENT MULTILINGUA ─────────────────────────────────────
const SENTIMENT = {
  veryPositive: ['festival','concerto','record','boom','crescita','vittoria','celebrazione','successo','campione','olimpiadi','rinascita','ottimismo','ripresa','accordo','pace','festival','concert','record','boom','growth','victory','celebration','award','winner','champion','recovery','agreement','peace','thriving','breakthrough','crecimiento','victoire','erfolg'],
  positive: ['buono','bello','miglioramento','ottimo','tranquillo','soleggiato','caldo','turismo','cultura','evento','sport','musica','arte','good','great','improve','better','warm','tourism','culture','event','sport','music','art','positive','progress','innovation','launch','collaboration'],
  negative: ['sciopero','protesta','incidente','maltempo','allerta','crisi','chiusura','emergenza','tensione','difficoltà','rallentamento','calo','pericolo','inquinamento','caos','ritardo','problema','strike','protest','incident','storm','alert','crisis','closure','emergency','tension','slowdown','decline','danger','pollution','chaos','delay','problem','concern','warning','dispute','controversy'],
  veryNegative: ['disastro','tragedia','morte','attacco','violenza','terrore','alluvione','incendio','omicidio','crollo','esplosione','guerra','conflitto','disaster','tragedy','death','attack','violence','terror','flood','fire','murder','collapse','explosion','war','conflict','massacre','shooting','earthquake','hurricane'],
  cold: ['freddo','neve','gelo','isolamento','vuoto','silenzio','solitudine','cold','snow','ice','isolated','lonely','empty','silent','dark','fog'],
};

function calcSentiment(text) {
  if (!text) return 0;
  const t = text.toLowerCase();
  let score = 0;
  SENTIMENT.veryPositive.forEach(w => { if (t.includes(w)) score += 15; });
  SENTIMENT.positive.forEach(w => { if (t.includes(w)) score += 8; });
  SENTIMENT.negative.forEach(w => { if (t.includes(w)) score -= 10; });
  SENTIMENT.veryNegative.forEach(w => { if (t.includes(w)) score -= 18; });
  SENTIMENT.cold.forEach(w => { if (t.includes(w)) score -= 6; });
  return Math.max(-100, Math.min(100, score));
}

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

async function ft(url, opts={}, ms=6000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {...opts, signal: ctrl.signal});
    clearTimeout(id); return res;
  } catch(e) { clearTimeout(id); throw e; }
}

// ── GNEWS API ─────────────────────────────────────────────────
async function fetchGNews(city) {
  if (!GNEWS_KEY) return {score:0, items:[]};
  try {
    // GNews API: cerca notizie per città, ultime 24h
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(city)}&lang=it,en&max=10&from=${new Date(Date.now()-24*60*60*1000).toISOString()}&token=${GNEWS_KEY}`;
    const r = await ft(url, {}, 6000);
    if (!r.ok) {
      // Fallback senza filtro lingua
      const r2 = await ft(`https://gnews.io/api/v4/search?q=${encodeURIComponent(city)}&max=10&token=${GNEWS_KEY}`, {}, 6000);
      if (!r2.ok) return {score:0, items:[]};
      const d2 = await r2.json();
      return processGNewsArticles(d2.articles || []);
    }
    const data = await r.json();
    return processGNewsArticles(data.articles || []);
  } catch(e) {
    return {score:0, items:[]};
  }
}

function processGNewsArticles(articles) {
  if (!articles.length) return {score:0, items:[]};
  let totalScore = 0;
  const items = [];
  articles.forEach(a => {
    const text = (a.title || '') + ' ' + (a.description || '');
    totalScore += calcSentiment(text);
    if (a.title) items.push(a.title.substring(0, 70));
  });
  return {
    score: totalScore / articles.length,
    items: items.slice(0, 4),
  };
}

// ── OPEN-METEO ────────────────────────────────────────────────
async function fetchWeather(lat, lng) {
  try {
    const r = await ft(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=weathercode,temperature_2m,precipitation,windspeed_10m&timezone=auto`,
      {}, 5000
    );
    if (!r.ok) return {score:0, desc:''};
    const d = await r.json();
    const code = d?.current?.weathercode ?? 0;
    const temp = d?.current?.temperature_2m ?? 15;
    const wind = d?.current?.windspeed_10m ?? 0;

    let score = 0, desc = '';
    if (code===0)       { score=35;  desc=`☀️ ${temp}°C soleggiato`; }
    else if (code<=2)   { score=20;  desc=`🌤️ ${temp}°C parz. nuvoloso`; }
    else if (code<=3)   { score=0;   desc=`⛅ ${temp}°C nuvoloso`; }
    else if (code<=48)  { score=-5;  desc=`🌫️ ${temp}°C nebbia`; }
    else if (code<=57)  { score=-15; desc=`🌦️ ${temp}°C pioggerella`; }
    else if (code<=67)  { score=-25; desc=`🌧️ ${temp}°C pioggia`; }
    else if (code<=77)  { score=-35; desc=`❄️ ${temp}°C neve`; }
    else if (code<=82)  { score=-20; desc=`🌦️ ${temp}°C rovesci`; }
    else                { score=-50; desc=`⛈️ ${temp}°C temporale`; }

    if (temp>28) score+=10; else if (temp>20) score+=5;
    else if (temp<5) score-=10; else if (temp<0) score-=20;
    if (wind>50) score-=10;

    return {score: Math.max(-100,Math.min(100,score)), desc};
  } catch(e) { return {score:0, desc:''}; }
}

// ── SUPABASE CHECKINS ─────────────────────────────────────────
async function fetchUserCheckins(lat, lng) {
  if (!SUPABASE_URL||!SUPABASE_KEY) return {score:0,count:0,weight:0};
  try {
    const sixH = new Date(Date.now()-6*60*60*1000).toISOString();
    const d = 0.09;
    const r = await ft(
      `${SUPABASE_URL}/rest/v1/checkins?lat=gte.${lat-d}&lat=lte.${lat+d}&lng=gte.${lng-d}&lng=lte.${lng+d}&created_at=gte.${sixH}&select=mood`,
      {headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}},
      5000
    );
    if (!r.ok) return {score:0,count:0,weight:0};
    const checkins = await r.json();
    if (!Array.isArray(checkins)||!checkins.length) return {score:0,count:0,weight:0};
    const score = checkins.reduce((s,c)=>s+(MOOD_VALS[c.mood]||0),0)/checkins.length;
    const count = checkins.length;
    let weight = 0;
    if (count>=200) weight=0.85;
    else if (count>=100) weight=0.75;
    else if (count>=25) weight=0.60;
    else if (count>=10) weight=0.40;
    else if (count>=3) weight=0.25;
    else weight=0.10;
    return {score, count, weight};
  } catch(e) { return {score:0,count:0,weight:0}; }
}

// ── CACHE ─────────────────────────────────────────────────────
async function getCached(city) {
  if (!SUPABASE_URL||!SUPABASE_KEY) return null;
  try {
    const sixH = new Date(Date.now()-6*60*60*1000).toISOString();
    const r = await ft(
      `${SUPABASE_URL}/rest/v1/city_cache?city=eq.${encodeURIComponent(city)}&updated_at=gte.${sixH}&select=*&limit=1`,
      {headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}},
      4000
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (data&&data.length>0)?{...data[0].data,cached:true}:null;
  } catch(e) { return null; }
}

async function setCache(city, result) {
  if (!SUPABASE_URL||!SUPABASE_KEY) return;
  try {
    await ft(`${SUPABASE_URL}/rest/v1/city_cache`, {
      method:'POST',
      headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
      body: JSON.stringify({city, data:result, updated_at:new Date().toISOString()}),
    }, 4000);
  } catch(e) {}
}

// ── HANDLER ───────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Content-Type':'application/json',
  };
  if (event.httpMethod==='OPTIONS') return {statusCode:200,headers,body:''};

  const params = event.queryStringParameters||{};
  const city = params.city||'Milano';
  const lat = parseFloat(params.lat||'45.46');
  const lng = parseFloat(params.lng||'9.19');

  // Cache
  const cached = await getCached(city);
  if (cached) return {statusCode:200,headers,body:JSON.stringify(cached)};

  // Fetch parallelo
  const [news, weather, users] = await Promise.all([
    fetchGNews(city),
    fetchWeather(lat, lng),
    fetchUserCheckins(lat, lng),
  ]);

  // Pesi dinamici
  const userWeight = users.weight;
  const extWeight = 1 - userWeight;
  const newsWeight = extWeight * 0.55;
  const weatherWeight = extWeight * 0.45;

  const externalScore = news.score*newsWeight + weather.score*weatherWeight;
  const mood = scoreToMood(externalScore, users.score, userWeight);
  const rawScore = externalScore*(1-userWeight) + users.score*userWeight;
  const score = Math.round(50 + rawScore*0.35);

  const result = {
    city, mood, score,
    user_checkins: users.count,
    user_weight: Math.round(userWeight*100),
    weather: weather.desc,
    sources: {
      news: news.items,
      users: users.count,
    },
    debug: {
      newsScore: Math.round(news.score),
      weatherScore: Math.round(weather.score),
      userScore: Math.round(users.score),
      combined: Math.round(rawScore),
      gnews_active: !!GNEWS_KEY,
    },
    updated_at: new Date().toISOString(),
  };

  await setCache(city, result);
  return {statusCode:200,headers,body:JSON.stringify(result)};
};
