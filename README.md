# BBQing Spec Editor

Embedded Shopify admin app for editing the `custom.specifications` metafield on products.

## Deploy

1. Create empty GitHub repo named `bbqing-spec-editor` and push this folder.
2. In Vercel: New Project → Import this repo → Framework Preset: Other → Deploy.
3. In Vercel Project → Settings → Environment Variables, add:
   - `SHOPIFY_API_KEY` (from Partner Dashboard → BBQing Specification Editor → Client credentials)
   - `SHOPIFY_API_SECRET` (same place)
   - `SHOPIFY_SHOP` = `bbqing-com.myshopify.com`
   - `APP_URL` = the Vercel URL (no trailing slash)
   - `SHOPIFY_SCOPES` = `read_products,write_products`
4. Redeploy after setting env vars.
5. In Shopify Partner Dashboard → BBQing Specification Editor → App setup:
   - App URL: `https://<vercel-url>.vercel.app`
   - Allowed redirection URL: `https://<vercel-url>.vercel.app/auth/callback`
6. Install the app on bbqing-com from Partner Dashboard → Test on development store or use the install link.

## Local dev

```
cp .env.example .env     # fill in values
npm install
npm start                # http://localhost:3030
```

## Notes

- Token exchange is used on first authenticated request — no manual OAuth round-trip needed when the embedded app loads.
- On Vercel, the offline token is cached in `/tmp` per lambda instance. Cold starts re-exchange from the session token (negligible overhead).
- Scopes: read/write products only. No customer, order, or financial access.
