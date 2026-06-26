// ══════════════════════════════════════════════════════════════
// mood.js — Netlify Function
// Riceve check-in mood e li salva su Supabase
// Include validazione input e gestione errori robusta
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

const VALID_MOODS = ['sunny', 'rainbow', 'cloudy', 'rainy', 'stormy', 'snowy'];

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return {statusCode:200, headers, body:''};
  if (event.httpMethod !== 'POST') {
    return {statusCode:405, headers, body: JSON.stringify({error:'Method not allowed'})};
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch(e) {
    return {statusCode:400, headers, body: JSON.stringify({error:'Invalid JSON'})};
  }

  const {mood, lat, lng, user_id} = body;

  // Validazione
  if (!mood || !VALID_MOODS.includes(mood)) {
    return {statusCode:400, headers, body: JSON.stringify({error:`Invalid mood. Must be one of: ${VALID_MOODS.join(', ')}`})};
  }
  if (lat === undefined || lng === undefined) {
    return {statusCode:400, headers, body: JSON.stringify({error:'lat and lng are required'})};
  }
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  if (isNaN(latF) || isNaN(lngF) || latF < -90 || latF > 90 || lngF < -180 || lngF > 180) {
    return {statusCode:400, headers, body: JSON.stringify({error:'Invalid coordinates'})};
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {statusCode:503, headers, body: JSON.stringify({error:'Database not configured'})};
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/checkins`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        mood,
        lat: latF,
        lng: lngF,
        user_id: (user_id || 'anonymous').substring(0, 64),
        created_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Supabase error ${res.status}: ${errText}`);
    }

    return {statusCode:200, headers, body: JSON.stringify({ok:true, mood, lat:latF, lng:lngF})};
  } catch(e) {
    console.error('mood.js error:', e.message);
    return {statusCode:500, headers, body: JSON.stringify({error:'Failed to save check-in', detail: e.message})};
  }
};
