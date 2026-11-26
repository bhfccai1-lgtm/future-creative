# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

# Development tools (installed for every session in this repo)
Configured in `.claude/settings.json` (plugins) and `.mcp.json` (MCP servers). Use them as below.

- **Grill Me** (`mattpocock-skills` → `grilling`; also the built-in `interview-me`) — BEFORE any big feature or a
  vague request: interview the owner one question at a time (in Arabic) until the goal, the audience and «done» are
  clear. Never ask for passwords or API keys. Write the agreed spec into the PR description.
- **Frontend Design** (`frontend-design` plugin; with the repo's `impeccable` skill) — for every new or redesigned
  page: the navy/gold identity (`navy-*`, `gold-*` Tailwind tokens, Cairo font), RTL first, real hierarchy, no
  generic AI look. Pages must work at 1360 px and at phone width (390 px) with no horizontal scroll.
- **Playwright MCP** (`.mcp.json` → `playwright`, pinned `@playwright/mcp@0.0.84`, uses the pre-installed
  `/opt/pw-browsers/chromium`, headless) — verify UI changes in a real browser before a PR: start services
  (`pg_ctlcluster 16 main start; redis-server --daemonize yes`), run `next dev`, log in, open the page at 1360 and
  390 px, click through the flow, check the console for errors. Screenshots go to `/tmp/playwright-mcp`.
- **Figma** (`figma` plugin → official Figma MCP) — read the owner's Figma frames/tokens and turn them into
  components, or push a page/design system to Figma. Needs the Figma connector signed in at
  claude.ai/customize/connectors (and `mcp.figma.com` reachable from the environment).
- **Hyperframes** (`hyperframes` plugin) — HTML-based motion for reels: animated text/price-free product reveals,
  caption styles and intros/outros rendered to MP4, then composed by `src/lib/video/reel.ts`. Keep the verified-copy
  rule: only system-checked text and the real phone numbers appear on screen.
