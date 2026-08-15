// netlify/functions/check-status.js
const { getCharacterStatus } = require('./lib/supabaseRest.js');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }
  var id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing id.' }) };
  }

  var config = {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };

  var status = await getCharacterStatus(config, id);
  if (status === null) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Not found.' }) };
  }
  return { statusCode: 200, body: JSON.stringify({ status: status }) };
};
