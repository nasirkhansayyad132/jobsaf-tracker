# Frontend

The React PWA for Afghanistan Tech Jobs. See the repository
[README](../README.md) for architecture, deployment, and data-pipeline details.

```bash
npm ci
npm test
npm run lint
npm run dev
```

Development reads the canonical `../docs/data/jobs.json` and `summary.json`
through a Vite-only middleware. `npm run build` writes to `dist/`; it never
writes into `docs/` or modifies published data.

Use `npm run build:pages` for a validated Pages artifact and
`npm run build:docs-snapshot` only when intentionally refreshing the guarded
fallback shell committed under `docs/`.
