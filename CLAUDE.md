# CLAUDE.md — Global AI News

This file provides guidance for AI assistants working in this codebase.

---

## Project Overview

**Global AI News** is an autonomous, AI-powered news platform that:
- Fetches AI/ML news from RSS feeds (TechCrunch AI, arXiv, MIT News)
- Uses Google Gemini to synthesize articles, generate images, and geocode locations
- Serves personalized content to users based on their language, interests, and subscription tier
- Provides user authentication, tiered subscriptions (Free / Basic / Premium), and a newsletter signup

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS 4, Vite 6 |
| Backend | Express.js (server.ts), runs via `tsx` in dev |
| Database | Better SQLite3 (`news.db`, created at runtime) |
| AI | Google GenAI SDK (`gemini-2.5-flash`, `gemini-2.5-flash-image`) |
| Auth | JWT (7-day expiry) + bcryptjs (10 rounds) |
| Payments | Stripe SDK (currently mocked — no real payments) |
| Animation | Motion (Framer Motion successor) |
| Icons | Lucide React |
| Markdown | react-markdown |
| Dates | date-fns |

---

## Repository Layout

```
/
├── server.ts           # Express backend — all API routes + AI logic
├── src/
│   ├── main.tsx        # React entry point
│   ├── App.tsx         # Entire frontend (monolithic, ~535 lines)
│   └── index.css       # Tailwind base styles
├── index.html          # Vite HTML template
├── vite.config.ts      # Vite + Tailwind + path aliases
├── tsconfig.json       # TypeScript config (strict, ES2022)
├── package.json        # Scripts and dependencies
├── .env.example        # Required environment variables
├── metadata.json       # AI Studio app metadata
└── news.db             # SQLite database (runtime, git-ignored)
```

> There are no separate component files. All frontend logic lives in `src/App.tsx`.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```
GEMINI_API_KEY=       # Google Gemini API key (required for news generation)
APP_URL=              # Deployment URL (e.g. http://localhost:3000)
STRIPE_SECRET_KEY=    # Stripe key (payments are mocked; optional for dev)
JWT_SECRET=           # Secret for signing JWTs (required for auth)
```

`GEMINI_API_KEY` is also injected into the Vite build via `define` in `vite.config.ts`, making it available on the client side.

---

## Development Commands

```bash
npm run dev       # Start dev server (tsx server.ts + Vite HMR)
npm run build     # Production build (Vite)
npm start         # Production server (node server.ts)
npm run preview   # Preview production build
npm run lint      # TypeScript type-check (tsc --noEmit)
npm run clean     # Remove dist/
```

> In development, `server.ts` uses Vite's middleware mode for HMR. Set `DISABLE_HMR=true` to disable HMR (e.g., for agent-driven edits in AI Studio).

---

## Database Schema

The SQLite database (`news.db`) is created at server startup. Four tables:

### `posts`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| title | TEXT | Article title |
| content | TEXT | Markdown body |
| image_url | TEXT | AI-generated image URL |
| location_name | TEXT | Geocoded place name |
| lat / lng | REAL | Coordinates |
| created_at | TEXT | ISO timestamp |
| is_premium | INTEGER | 0 = free, 1 = premium |
| tags | TEXT | JSON array string |
| source_url | TEXT | Original RSS link |

### `subscribers`
| Column | Type |
|---|---|
| id | INTEGER PK |
| email | TEXT UNIQUE |
| created_at | TEXT |

### `users`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| email | TEXT UNIQUE | |
| password | TEXT | bcrypt hash |
| tier | TEXT | 'free', 'basic', 'premium' |
| interests | TEXT | JSON array |
| language | TEXT | e.g. 'en', 'es' |
| stripe_customer_id | TEXT | |
| stripe_subscription_id | TEXT | |
| created_at | TEXT | |

### `user_views`
| Column | Type |
|---|---|
| user_id | INTEGER |
| post_id | INTEGER |
| viewed_at | TEXT |
Primary key: `(user_id, post_id)`

> Schema migrations use `try/catch` around `ALTER TABLE` statements to safely add new columns without breaking existing databases.

---

## Backend API Routes (`server.ts`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/posts` | Optional | Fetch posts (personalized if logged in) |
| POST | `/api/posts/:id/view` | Optional | Track post view |
| POST | `/api/subscribe` | No | Newsletter signup |
| POST | `/api/auth/register` | No | Register new user |
| POST | `/api/auth/login` | No | Login and get JWT |
| GET | `/api/auth/me` | Yes | Get current user |
| POST | `/api/generate` | No | Manually trigger news generation |
| POST | `/api/stripe/checkout` | No | Tier upgrade (mocked) |

### Personalization (`GET /api/posts`)
When a valid JWT is provided, the server:
1. Filters out premium posts for free-tier users
2. Calls Gemini (`gemini-2.5-flash`) to rewrite each article in the user's language and framed around their interests
3. Returns adapted content with ads injected for free-tier users

---

## AI News Generation Pipeline

Triggered at server startup (if no posts exist) and every 4 hours via `setInterval`:

1. **RSS Fetch** — Pull latest items from 3 feeds:
   - TechCrunch AI
   - arXiv CS.AI
   - MIT News AI

2. **Content Synthesis** — Send feed items to `gemini-2.5-flash-preview-04-17` with a structured `responseSchema` to generate:
   - Title, markdown content, tags, `is_premium` flag, source URL
   - Up to 5 articles per run

3. **Image Generation** — For each article, call `gemini-2.5-flash-preview-05-20` with `responseModalities: ['IMAGE', 'TEXT']` to produce an inline base64 image, saved to `public/images/`.

4. **Geocoding** — Use `gemini-2.5-flash` with `googleSearch` tool to extract `location_name`, `lat`, `lng` for each story.

5. **Persist** — Insert completed articles into the `posts` table.

---

## Frontend Architecture (`src/App.tsx`)

All UI lives in a single monolithic component. Key state:

```ts
posts: Post[]           // Fetched articles
user: UserData | null   // Current authenticated user
loading: boolean
showAuth: boolean       // Auth modal visibility
showPricing: boolean    // Pricing modal visibility
authMode: 'login' | 'register'
authError: string
```

### Key interfaces
```ts
interface Post {
  id: number;
  title: string;
  content: string;
  image_url: string;
  location_name: string;
  lat: number;
  lng: number;
  created_at: string;
  is_premium: number;
  tags: string[];
  source_url: string;
  is_ad?: boolean;       // Injected server-side for free users
}

interface UserData {
  id: number;
  email: string;
  tier: 'free' | 'basic' | 'premium';
  interests: string[];
  language: string;
}
```

### Layout structure
- **Header** — Logo, generate button, language/tier badge, login/user menu
- **Hero** — First post rendered as a large featured card
- **Grid** — Remaining posts in a responsive 2-3 column grid
- **Auth Modal** — Login / Register form overlay
- **Pricing Modal** — Three-tier pricing cards
- **Newsletter** — Email capture widget at bottom

### JWT persistence
JWT is stored in `localStorage` under the key `token`. On mount, if a token exists, `GET /api/auth/me` is called to restore session.

---

## Coding Conventions

### TypeScript
- Strict mode enabled; avoid `any` unless necessary
- Define interfaces for all data shapes before use
- Use `async/await` with `try/catch` for all async operations

### React
- Functional components with hooks only
- `useEffect` for data fetching and side effects
- State as close to usage as possible
- `e.preventDefault()` on all form submissions

### Error handling
- Always wrap `fetch` calls in `try/catch`
- Show user-facing error messages through state (not `alert()`)
- Use `console.error` for development logging

### Styling
- Use Tailwind utility classes directly on JSX elements
- Color palette: `zinc` (neutrals), `indigo` (primary), `emerald` (success/premium)
- Mobile-first responsive design (`sm:`, `md:`, `lg:` breakpoints)
- No external CSS modules or styled-components

### Naming
- `camelCase` for variables and functions
- `PascalCase` for React components and TypeScript interfaces
- Event handlers prefixed with `handle` (e.g., `handleAuth`, `handleSubmit`)

---

## Adding New Features

### Adding a new API route
1. Open `server.ts`
2. Define the route handler using `app.get/post/put/delete`
3. Use the `authenticateToken` middleware for protected routes
4. Query the SQLite `db` object directly (synchronous via better-sqlite3)

```ts
app.get('/api/example', authenticateToken, (req, res) => {
  const rows = db.prepare('SELECT * FROM posts WHERE id = ?').all(req.user.id);
  res.json(rows);
});
```

### Adding a new UI section
Since all frontend code is in `src/App.tsx`, add new JSX directly in the return block. For non-trivial additions, consider extracting to a new component file under `src/components/`.

### Adding a new database column
Use the try/catch migration pattern in `server.ts` inside the `initDb()` function:

```ts
try {
  db.exec('ALTER TABLE posts ADD COLUMN new_column TEXT');
} catch (e) {
  // Column already exists — safe to ignore
}
```

---

## Known Limitations & TODOs

- **Stripe is mocked** — `POST /api/stripe/checkout` upgrades tier in the DB but never calls the real Stripe API
- **No tests** — No testing framework (Vitest, Jest) is configured
- **No ESLint** — Only `tsc --noEmit` is used for linting
- **JWT in localStorage** — Susceptible to XSS; consider `httpOnly` cookies for production
- **Monolithic frontend** — All UI in `App.tsx`; should be split into components as the app grows
- **CORS not configured** — Relies on same-origin serving; add explicit CORS headers for separate frontend/backend deployments
- **Image storage** — AI-generated images written to `public/images/` as static files; not suitable for scalable cloud deployments

---

## Git Workflow

- Default development branch: `master`
- Feature/task branches follow the pattern: `claude/<task-id>`
- Commit messages use the conventional format: `feat:`, `fix:`, `chore:`, `docs:`
- Commits are signed (SSH signing configured)

When working on a GitHub issue or task:
1. Check out the designated branch (e.g., `claude/claude-md-mmm4c903nl2hfmzr-uKfmv`)
2. Make changes, commit with a descriptive message
3. Push with `git push -u origin <branch-name>`
