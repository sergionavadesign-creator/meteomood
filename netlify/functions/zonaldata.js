// ══════════════════════════════════════════════════════════════
// zonaldata.js — Netlify Function
// Calcola mood per zona geografica specifica basandosi sui
// check-in utenti nel raggio specificato (Supabase PostGIS)
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

const MOOD_VALS = {
  rainbow: 100, sunny: 70, cloudy: 0,
  rainy: -30, snowy: -60, stormy: -80,
};

function scoreToMood(score) {
  if (score > 55) return 'rainbow';
  if (score > 20) return 'sunny';
  if (score > -15) return 'cloudy';
  if (score > -45) return 'rainy';
  if (score < -65) return 'stormy';
  return 'snowy';
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return {statusCode:200, headers, body:''};

  const {lat, lng, radius = '0.005'} = event.queryStringParameters || {};
  if (!lat || !lng) {
    return {statusCode:400, headers, body: JSON.stringify({error:'Missing lat/lng'})};
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const r = parseFloat(radius);
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {statusCode:200, headers, body: JSON.stringify({mood:'cloudy', count:0, message:'DB not configured'})};
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/checkins`
      + `?lat=gte.${latF-r}&lat=lte.${latF+r}`
      + `&lng=gte.${lngF-r}&lng=lte.${lngF+r}`
      + `&created_at=gte.${sixHoursAgo}`
      + `&select=mood,lat,lng,created_at`
      + `&order=created_at.desc&limit=200`;

    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
    const checkins = await res.json();

    if (!checkins.length) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({mood:'cloudy', count:0, message:'Nessun check-in in questa zona'}),
      };
    }

    // Calcola media pesata (check-in più recenti pesano di più)
    let weightedSum = 0, totalWeight = 0;
    checkins.forEach((c, i) => {
      const w = 1 / (i + 1); // peso decrescente per recency
      weightedSum += (MOOD_VALS[c.mood] || 0) * w;
      totalWeight += w;
    });
    const avg = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const mood = scoreToMood(avg);

    // Distribuzione
    const dist = {rainbow:0, sunny:0, cloudy:0, rainy:0, stormy:0, snowy:0};
    checkins.forEach(c => { dist[c.mood] = (dist[c.mood] || 0) + 1; });

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        mood,
        count: checkins.length,
        distribution: dist,
        avg_score: Math.round(avg),
        updated_at: new Date().toISOString(),
      }),
    };
  } catch(e) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({error: e.message, mood:'cloudy', count:0}),
    };
  }
};
