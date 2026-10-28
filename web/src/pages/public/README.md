# Public pages

Signed-out pages: the landing page, the privacy policy and the terms. Each page wraps itself in `PublicLayout` (header with the product name and a Sign in link to `/signin`, footer with Privacy, Terms, GitHub), so every route is one element and nothing here depends on `App.tsx` beyond the three routes below.

## Wiring the routes

In `web/src/App.tsx`, import the pages and add three routes for signed-out visitors. The dashboard keeps `/` once the visitor is signed in, so the `/` route is whichever element the auth guard picks:

```tsx
import { Landing, Privacy, Terms } from '@/pages/public';

<Route path="/" element={signedIn ? <DashboardPage /> : <Landing />} />
<Route path="/privacy" element={<Privacy />} />
<Route path="/terms" element={<Terms />} />
```

`/privacy` and `/terms` are public whether or not the visitor is signed in (the footer of the signed-in app can link to them too). `PublicLayout` uses `useTheme()` from `@/lib/theme`, which `main.tsx` already provides, so dark mode follows the same toggle and the same `collected.theme` key as the dashboard.

## Placeholders to fill in

- `OPERATOR_EMAIL` in `PublicLayout.tsx` (the upstream hosted instance uses admin@priyamkabra.com; change it) is the hosted instance's contact address; it appears in the privacy policy, the terms, and the landing page's invite link.
- `GOVERNING_JURISDICTION` in `PublicLayout.tsx`, used by `Terms.tsx`.
- `GITHUB_URL` in `PublicLayout.tsx` if the repository moves.
- The product screenshot: the landing page loads `/docs/screenshots/dashboard.png`. Vite serves `web/public/` at the web root, so put the image at `web/public/docs/screenshots/dashboard.png` (a copy or symlink of `docs/screenshots/dashboard.png`). Until it exists the slot renders a placeholder grid rather than a broken image.
- The "Last updated" dates are `PRIVACY_UPDATED` and `TERMS_UPDATED`; move them when the text changes.
