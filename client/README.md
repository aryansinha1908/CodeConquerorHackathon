# ShareX client

The React SPA for ShareX (React 19, Vite 8, React Router 7, TanStack Query 5, Tailwind CSS 4).

- **Setup, scripts and demo logins:** the [repository README](../README.md).
- **Pages, components and data fetching:** [`docs/frontend.md`](../docs/frontend.md).
- **The API it calls:** [`docs/api.md`](../docs/api.md). Every request goes to `/api/v1` on the page's own origin: the Vite dev server proxies it to `http://localhost:5000` (`vite.config.js`), and in production Vercel rewrites it to the Render API (`vercel.json`, [`docs/deploy.md`](../docs/deploy.md)).

```
npm install
npm run dev      # http://localhost:5173, with the API running on :5000
npm test
npm run lint
npm run build    # into dist/
```
