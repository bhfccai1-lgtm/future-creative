## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## Creative Design Playbook V10.0 (owner's rules — always apply)

Full text: `docs/CREATIVE_DESIGN_PLAYBOOK.md` · implementation status: `docs/CREATIVE_PLAYBOOK_STATUS.md`.
Core rules for any design / ad / prompt / QC work:
- Improve incrementally; never break working functions. Engines are modular, measurable and tested.
- Ideas: the customer need first, 10 genuinely different ideas across the playbook's approaches → top 3 → develop the best. A colour/background change is not a new idea.
- Hybrid layers: the image model draws the scene only — real fonts set the text; the ORIGINAL logo file only (never AI-drawn); exact approved numbers: سار 33316319 · سلماباد 34315316 · التوصيل 33930900 (caption, when needed). Never invent prices, offers or contacts. Check Arabic text and RTL.
- Every image prompt has the explicit negative prompt; product shapes, proportions and use stay real.
- Creative Quality Score (§12, `src/lib/creative/ad-score.ts`): 100 points; 95+ candidate · 90–94 review · 80–89 improve · < 80 redesign. A logo, text, product or phone error blocks approval whatever the score. Scores are internal — never a promise of reach.
- Anti-repetition over 30 days per account (SHA-256, pHash, headline/idea similarity). Bounded revision loops; persistent failure goes to a human with the reason.
- No automatic publishing beyond the owner's settings, no new paid services, no exposed keys, no production change without the owner's explicit approval.
