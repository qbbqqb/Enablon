# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages, layouts, and API routes (`app/api/*/route.ts`). Global styles in `app/globals.css`.
- `components/`: Reusable UI components (React, TypeScript).
- `lib/`: Core logic and utilities grouped by domain (`ai/`, `files/`, `csv/`, etc.). Types live in `lib/types.ts`.
- `__tests__/`: Jest tests. Tests may also be colocated as `*.test.ts(x)` or `*.spec.ts(x)`.

## Build, Test, and Development Commands
- `npm run dev`: Start the local dev server.
- `npm run build`: Create a production build.
- `npm start`: Serve the production build.
- `npm run lint`: Run ESLint (Next.js config). Add `--fix` to auto-fix.
- `npm run typecheck`: TypeScript checks with `tsc --noEmit`.
- `npm test` / `npm run test:watch`: Run Jest tests once or in watch mode.

## Coding Style & Naming Conventions
- **Language**: TypeScript with `strict` mode enabled.
- **Indentation**: 2 spaces; keep lines focused and readable.
- **Files**: kebab-case for filenames (e.g., `progress-bar.tsx`).
- **Identifiers**: `PascalCase` for React components, `camelCase` for functions/variables, `SCREAMING_SNAKE_CASE` for constants.
- **Imports**: Prefer `@/*` path alias (configured in `tsconfig.json`).
- **Styling**: Tailwind CSS in components; minimal global CSS in `app/globals.css`.

## Testing Guidelines
- **Framework**: Jest via `next/jest` (Node environment).
- **Location**: Place tests in `__tests__/` or use `*.test.ts(x)` / `*.spec.ts(x)`.
- **Naming**: Describe behavior, not implementation (e.g., `csv.parse handles quoted values`).
- **Running**: `npm test` (optionally `--coverage`). Keep tests deterministic and fast.

## Commit & Pull Request Guidelines
- **Commits**: Use concise, imperative subject lines (present tense). Examples: “Fix TypeScript error in batch code”, “Implement simple API for uploads”.
- **Branches**: Use descriptive names like `feat/...`, `fix/...`, or `chore/...`.
- **PRs**: Include a clear description, linked issues, screenshots for UI changes, and test notes (what was added/affected). Ensure `lint` and `typecheck` pass.

## Security & Configuration Tips
- Store secrets in `.env.local`; never commit them. Use `NEXT_PUBLIC_` only for values safe to expose to the client.
- Review `next.config.js` and `vercel.json` when changing build/runtime behavior.
