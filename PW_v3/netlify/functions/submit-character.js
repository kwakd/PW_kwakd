// netlify/functions/submit-character.js
const crypto = require('crypto');
const validation = require('../../playground/validation.js');
const { insertPendingCharacter, countRecentSubmissions } = require('./lib/supabaseRest.js');

const RATE_LIMIT_MAX_PER_HOUR = 5;

function hashIp(ip, salt) {
  return crypto.createHash('sha256').update(salt + ip).digest('hex');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  var payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON.' }) };
  }

  var titleCheck = validation.validateTitle(payload.title);
  if (!titleCheck.valid) {
    return { statusCode: 400, body: JSON.stringify({ error: titleCheck.error }) };
  }
  var messageCheck = validation.validateMessage(payload.message);
  if (!messageCheck.valid) {
    return { statusCode: 400, body: JSON.stringify({ error: messageCheck.error }) };
  }
  var imageCheck = validation.validateImageDataUrl(payload.imageDataUrl);
  if (!imageCheck.valid) {
    return { statusCode: 400, body: JSON.stringify({ error: imageCheck.error }) };
  }

  var config = {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  var salt = process.env.IP_HASH_SALT || '';

  var headers = event.headers || {};
  var ip = headers['x-nf-client-connection-ip'];
  if (!ip) {
    var forwardedFor = headers['x-forwarded-for'] || '';
    ip = forwardedFor.split(',')[0].trim();
  }
  ip = ip || 'unknown';
  var ipHash = hashIp(ip, salt);

  var sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  var recentCount = await countRecentSubmissions(config, ipHash, sinceIso);
  if (recentCount >= RATE_LIMIT_MAX_PER_HOUR) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Too many submissions. Try again later.' }) };
  }

  var result = await insertPendingCharacter(config, {
    title: payload.title,
    message: payload.message,
    imageDataUrl: payload.imageDataUrl,
    ipHash: ipHash
  });

  return { statusCode: 200, body: JSON.stringify({ id: result.id }) };
};
