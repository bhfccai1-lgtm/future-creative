# Source
Vendored from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) at commit `1a2c79d` (MIT licence, Vercel Engineering).
Only `SKILL.md`, `rules/` and `metadata.json` are copied. The upstream build tooling (`README.md`) and the generated `AGENTS.md` are not.
One line in `SKILL.md` now points to `rules/` instead of the missing `AGENTS.md`. It was reviewed before adding: the rules are documentation only, with no scripts and no remote instructions.
Update: re-copy these three items from a newer upstream commit and change the commit above.

## How it applies here
FUTURE CREATIVE is Next.js 15 (App Router) + React 19. The rules that matter most are:
- `async-*`: parallel database calls in server pages, for example `Promise.all` in `src/app/(dash)/**/page.tsx`.
- `bundle-*`: heavy client components such as `print-studio.tsx` and `edu-studio.tsx`.
- `server-*`: per-request caching of `getSettings()` and `getBusiness()`.
