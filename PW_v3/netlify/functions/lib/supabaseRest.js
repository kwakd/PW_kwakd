// netlify/functions/lib/supabaseRest.js
// Thin wrapper around Supabase's PostgREST API using the service_role
// key. Server-side only -- never expose SUPABASE_SERVICE_ROLE_KEY to
// the browser.

async function insertPendingCharacter(config, data) {
  var res = await fetch(config.url + '/rest/v1/characters', {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: 'Bearer ' + config.serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      title: data.title,
      message: data.message || null,
      image_data: data.imageDataUrl,
      ip_hash: data.ipHash,
      status: 'pending'
    })
  });
  if (!res.ok) {
    throw new Error('Supabase insert failed: ' + res.status + ' ' + (await res.text()));
  }
  var rows = await res.json();
  return { id: rows[0].id };
}

async function countRecentSubmissions(config, ipHash, sinceIso) {
  var url = config.url + '/rest/v1/characters?select=id&ip_hash=eq.' +
    encodeURIComponent(ipHash) + '&created_at=gte.' + encodeURIComponent(sinceIso);
  var res = await fetch(url, {
    headers: {
      apikey: config.serviceKey,
      Authorization: 'Bearer ' + config.serviceKey
    }
  });
  if (!res.ok) {
    throw new Error('Supabase count failed: ' + res.status + ' ' + (await res.text()));
  }
  var rows = await res.json();
  return rows.length;
}

async function getCharacterStatus(config, id) {
  var url = config.url + '/rest/v1/characters?select=status&id=eq.' + encodeURIComponent(id);
  var res = await fetch(url, {
    headers: {
      apikey: config.serviceKey,
      Authorization: 'Bearer ' + config.serviceKey
    }
  });
  if (!res.ok) {
    throw new Error('Supabase status lookup failed: ' + res.status + ' ' + (await res.text()));
  }
  var rows = await res.json();
  if (rows.length === 0) return null;
  return rows[0].status;
}

module.exports = { insertPendingCharacter, countRecentSubmissions, getCharacterStatus };
