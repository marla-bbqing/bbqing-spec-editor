// index.js — BBQing spec editor (embedded Shopify app).
// Auth: OAuth install → offline token (Admin calls); App Bridge session token verified per /api request.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { gql } = require('./shopify');
const auth = require('./auth');
const layouts = require('../data/layouts.json');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------------- security headers (Shopify embedded-app requirements) ----------------
// frame-ancestors → only Shopify admin may iframe the app (clickjacking protection);
// plus HSTS, nosniff, and a strict referrer policy.
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', `frame-ancestors https://${auth.SHOP} https://admin.shopify.com`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const gid = id => (String(id).startsWith('gid://') ? id : `gid://shopify/Product/${id}`);
const PUB = path.join(__dirname, '..', 'public');
const getCookie = (req, name) => {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return c ? decodeURIComponent(c.slice(name.length + 1)) : null;
};

// ---------------- OAuth install (CSRF-protected via signed state cookie) ----------------
app.get('/auth', (req, res) => {
  const shop = req.query.shop || auth.SHOP;
  if (!shop) return res.status(400).send('missing ?shop');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) return res.status(400).send('invalid shop');
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  res.redirect(auth.installUrl(shop, state));
});
app.get('/auth/callback', async (req, res) => {
  try {
    if (!auth.verifyOAuthHmac(req.query)) return res.status(400).send('HMAC validation failed');
    const cookieState = getCookie(req, 'oauth_state');
    if (!req.query.state || !cookieState || req.query.state !== cookieState) return res.status(400).send('state mismatch');
    res.setHeader('Set-Cookie', 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
    const { shop, code, host } = req.query;
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) return res.status(400).send('invalid shop');
    const token = await auth.exchangeCode(shop, code);
    auth.saveToken(shop, token);
    res.redirect(`/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host || '')}`);
  } catch (e) { res.status(500).send('auth error: ' + e.message); }
});

// ---------------- embedded app shell (inject API key for App Bridge) ----------------
app.get('/', (_req, res) => {
  let html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  html = html.replace(/__API_KEY__/g, auth.API_KEY || '');
  res.set('Content-Type', 'text/html').send(html);
});
app.use(express.static(PUB, { index: false }));

// ---------------- API (session-token protected) ----------------
app.use('/api', auth.requireSession);

app.get('/api/layouts', (_req, res) => res.json(layouts));

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const terms = q.split(/\s+/).filter(Boolean).map(t => t.replace(/[:"()]/g, ''));
    const titleQ = terms.map(t => `title:*${t}*`).join(' AND ');
    const queryStr = q ? `(${titleQ}) OR sku:*${q}*` : '';
    const data = await gql(
      `query($q:String){ products(first:25, query:$q, sortKey:RELEVANCE){ edges{ node{
        id title handle productType
        featuredImage{ url(transform:{maxWidth:80,maxHeight:80}) }
        variants(first:1){ edges{ node{ sku } } }
        layout: metafield(namespace:"custom", key:"spec_layout"){ value }
        specs: metafield(namespace:"custom", key:"specifications"){ value }
      } } } }`,
      { q: queryStr }
    );
    const items = data.products.edges.map(({ node }) => ({
      id: node.id, title: node.title, handle: node.handle, productType: node.productType,
      image: node.featuredImage && node.featuredImage.url,
      sku: node.variants && node.variants.edges[0] && node.variants.edges[0].node.sku,
      spec_layout: node.layout && node.layout.value,
      rowCount: node.specs && node.specs.value ? JSON.parse(node.specs.value).length : 0,
    }));
    res.json({ items });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get('/api/product/:id', async (req, res) => {
  try {
    const data = await gql(
      `query($id:ID!){ product(id:$id){ id title handle productType options{ name values }
        layout: metafield(namespace:"custom", key:"spec_layout"){ value }
        specs: metafield(namespace:"custom", key:"specifications"){ value } } }`,
      { id: gid(req.params.id) }
    );
    const p = data.product;
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json({
      id: p.id, title: p.title, handle: p.handle, productType: p.productType, options: p.options,
      spec_layout: (p.layout && p.layout.value) || '',
      specifications: p.specs && p.specs.value ? JSON.parse(p.specs.value) : [],
    });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/product/:id', async (req, res) => {
  try {
    const { spec_layout, specifications } = req.body || {};
    if (!Array.isArray(specifications)) return res.status(400).json({ error: 'specifications must be an array' });
    const rows = specifications
      .filter(r => r && r.group && r.label && String(r.value).trim() !== '')
      .map(r => { const row = { group: String(r.group), label: String(r.label), value: String(r.value) }; if (r.key) row.key = String(r.key); return row; });
    const mf = [{ ownerId: gid(req.params.id), namespace: 'custom', key: 'specifications', type: 'json', value: JSON.stringify(rows) }];
    if (spec_layout) mf.push({ ownerId: gid(req.params.id), namespace: 'custom', key: 'spec_layout', type: 'single_line_text_field', value: String(spec_layout) });
    const data = await gql(`mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ userErrors{ field message } } }`, { mf });
    const errs = data.metafieldsSet.userErrors;
    if (errs && errs.length) return res.status(400).json({ error: errs.map(e => e.message).join('; ') });
    res.json({ ok: true, saved: rows.length });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// On Vercel the server is wrapped as a serverless function — don't call listen().
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3030;
  app.listen(PORT, () => console.log(`spec-editor listening on :${PORT}`));
}

module.exports = app;
