# Production pipeline V6 — how an advertisement is made

Code entry point: `src/lib/pipeline/generate.ts` → `generateAdvertisement()` (runs in the worker).

| Step | What happens | Module |
|---|---|---|
| 01 Product selection | Approved, active catalogue product; weighted by account tags, performance and recency. | `creative/selector.ts` |
| 02 Creative concept | When the owner gave no idea: 3 concepts are proposed, then ranked by the rubric below; the winner (and all 3 scores) are stored in `options.conceptSelection`. The brief is rejected and re-written if its idea/headline repeats the last 30 days. | `creative/concept-select.ts`, `dedup/` |
| 03 Scene production | Image model (OpenAI). Real product photo attached when uploaded; reference design used **as a written style description only**. Concept / lighting / lens / poster layout rotated per account (least-recently-used). | `ai/openai-provider.ts`, `creative/references.ts`, `pickArt()` |
| 04 Poster composition | Full-AI poster (headline, badge, features, decor, product drawn by the model) or layered templates. | `ai/prompts.ts` `fullPosterPrompt` |
| 05 Brand integration | Approved logo PNG (hash-verified, never AI-drawn), CTA «اطلب الآن», سار 33316319 · سلماباد 34315316 as separate layers in a manifest. No approved logo → generation stops (`loadApprovedLogo`). | `render/poster.ts`, `render/compose.ts`, `brand/logo.ts` |
| 06 Quality assurance | Logo pixels vs approved asset, phone numbers, layout/safe area, contrast, glyph coverage, dimensions, duplicates (idea fingerprint + perceptual hash), caption quality, claims. Full-AI text is machine-read and compared with the approved copy. | `qc/` |
| 07 Revision | Misspelled drawn text → re-draw with an exact correction (up to `aiFullTextRetries`). Still unverified → the design is re-rendered with **system-typeset Arabic** (`verifiedTextFallback`), so unverified lettering is never shipped. Caption without CTA → official CTA + numbers appended. | `generate.ts` |
| 08 Export | JPEG for publishing + lossless PNG master; `GET /api/ads/:id/export` (PNG default, `?format=jpg`). Default size 1080×1920. | `api/ads/[id]/export` |
| 09 Approval | Saved as `QUALITY_REVIEW` (pending human review). Publishing only through the approval / authorised-autonomy workflow. | approvals |

## STEP 02 rubric (0–100)
- **Creative strength 40 %** — the model's 1–10 rating.
- **Novelty 30 %** — 1 − highest word overlap (Jaccard) with the account's ideas/headlines of the last 30 days.
- **Fit 20 %** — suggested format matches; humour on a formal/corporate account is penalised.
- **Angle freshness 10 %** — angle not among the last 10 used.
- A concept with a forbidden commercial claim (price, discount, free, «الأفضل»…) gets −100 and cannot win while a clean one exists.

Scores rank options; they are **not** proof of quality — a human approves every design.

## Settings (AI settings)
`conceptTournament` (on), `verifiedTextFallback` (on), `aiFullTextRetries` (2), `useReferences` (on), `styleReferenceKey/Brief`, `bestOf`, `aiFullRequiresApproval` (on).

## Tests
`tests/integration/v6-pipeline.test.ts` — custom printed mug and roll-up banner through the whole pipeline (3 concepts → poster → brand layers → QA → pending review, PNG 1080×1920) and the verified-text fallback. Image/text models are test doubles: the tests verify the pipeline logic and the deterministic layers, **not** the artistic quality of real model output.
