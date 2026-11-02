// shopify.js — Admin API helper. Uses the OAuth offline access token obtained during
// app install (stored on disk by auth.js). No client-credentials shortcut.
const { loadToken, SHOP } = require('./auth');
const STORE = SHOP || process.env.SHOPIFY_STORE;
const API_VERSION = '2025-07';
const API = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

function getToken() {
  const t = loadToken();
  if (!t || !t.access_token) throw new Error('App not installed — visit /auth to install and grant access.');
  return t.access_token;
}

async function gql(query, variables) {
  const token = await getToken();
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const d = await res.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors));
  return d.data;
}

module.exports = { gql, STORE };
