# Changelog

## Unreleased
- **✨ Drive الذكي (smart Drive)** — archive script v3, Settings → Integrations → Google archive (off by default):
  - **Live performance sheet:** every night the «published» sheet gets each design's real numbers: views, reach, saves, shares, comments, retention, skip and a performance score.
  - **«⭐ أفضل التصاميم» (best designs):** the best 3 designs of each account (last 30 days, at least 20 views) are copied once into a per-account folder, a portfolio ready to share with new customers.
  - **Monthly smart report** in Google Docs → «التقارير» (reports), on day 1 of each month. The AI writes it from the real numbers in one small text call and labels interpretations; without a key it is written from the numbers alone, and the raw numbers are always appended.
  - **Buttons:** «زامن الآن» (sync now) and «أنشئ التقرير الشهري الآن» (create this month's report now).
- **«واتساب الذكي» (smart WhatsApp)** — the official WhatsApp Cloud API (Settings → Integrations):
  - **Your assistant on WhatsApp.** Your number talks to the smart assistant: questions, designs, plan ideas. An action runs only when you reply «تأكيد» (confirm) within 15 minutes; «إلغاء» (cancel) cancels it.
  - **Customer messages → leads.** Every customer who writes becomes a lead in «العملاء والطلبات» (customers & orders), with a notification. Later messages are added to the same lead, so there are no duplicates.
  - **Optional welcome reply,** at most once every 24 hours per customer.
  - **Security.** Webhooks are verified with the Meta App Secret (X-Hub-Signature-256), and each message is handled only once. Tokens are stored encrypted. The page shows the Callback URL and Verify token to copy into Meta.
- **New «المساعد الذكي» (smart assistant)** — one chat instead of 30 pages, the first item in the menu. Write in Gulf Arabic («شنو وضع النظام؟», «أي حساب أداؤه أفضل؟», «صمم ريل لحساب الأكواب عن العيد الوطني»):
  - **Tools:** the model plans and uses read-only tools: system health, accounts, one account's plan, the approval queue, products. It answers from the real results and never invents numbers.
  - **Actions** (design now, approve plan ideas) are **only proposed**. Nothing runs until you press «تأكيد» (confirm). The proposal is signed, valid for 15 minutes, tied to your user, and your permission is checked again.
  - **Costs:** every AI call is budgeted and recorded.
  - **Without an AI key:** it still answers status, approvals and accounts for free.
- **Menu organised into groups:** Content, Publishing, Customers & sales, Growth & analysis, Studios, System. The ~30 pages were one long list in the sidebar and the phone «المزيد» (more) sheet. Fix: a page no longer lights up a sibling that only shares its start, such as «الحسابات الاجتماعية» (social accounts) on «خطة الحسابات» (accounts plan).
- **Release train:** brings to `main` the work merged into intermediate branches. That is the print-studio design idea (#25), the accounts plan (#26), the professional education images (#27) and Google Drive cold storage (#29). Development rule from now on: no stacked PRs; every PR is based on `main`.
- **Google Drive for designs, videos and database backups** (Settings → Integrations → Google archive):
  - **Confirmed copies.** The archive script (v2) returns the Drive id and size of every saved file, and the system records them. A script answer of `ok:false` is now retried; before, it was counted as delivered.
  - **Free server space** (off by default). Each night, designs published more than N days ago (default 45) are removed from the server, but only when Drive holds a copy of exactly the same size. The dashboard then opens them from Drive. Thumbnails, drafts, print and education files stay on the server.
  - **«حرّر المساحة الآن» (free space now)** and «أرشفة المنشورات غير المؤرشفة» (archive unarchived posts) buttons, plus live numbers: on Drive, moved, MB freed, MB still on the server.
  - **Daily database backup to Drive:** `scripts/drive-backup.sh` (plus a one-line cron) uploads the dump in parts of up to 20 MB, each size verified, to the archive folder's `backups/`. Drive keeps the last 30; the server keeps only the last 3. The database itself still runs on the server.
  - **`scripts/backup.sh` keeps 3 full backups instead of 14** (`FC_KEEP_BACKUPS`). Each one holds all media, and 14 of them filled the disk.
- **EDUCATION MASTER — professional AI images:**
  - **The cover is the style reference.** It is painted first, and the backgrounds and section illustrations are generated with it as a reference (palette, light, finish), so the brochure looks like one piece.
  - **One shared art direction for all images.**
  - **New «شخصية على الغلاف» (cover character):** a Bahraini boy (thobe and ghutra) or girl (hijab), as a 3D character whose age follows the grade. Never used for Islamic studies.
  - **New «صور المعارض» (gallery pictures):** in the glossy style, galleries default to realistic photos.
  - **Accurate landmarks:** 10 well-known Bahrain landmarks are described precisely, so the model does not invent their shape.
  - Every word stays system-typeset, and every image passes the quality gate.
- **New page «خطة الحسابات» (accounts plan)** — a content strategist for every account, built from the real Metricool numbers the system imports for its own publications (last 30 days):
  - **Overview:** totals and a table ranking every account by views, saves, retention and skip rate, with its most important problem.
  - **The best post** and the metric it stood out in.
  - **Openings against skips:** question openings compared with statement or product openings, against the 3-second skip rate.
  - **Posting against views:** posting frequency compared with views per post.
  - **Problems, each with its fix:** Reels shown to many people but skipped; no comments or shares; posting more while views drop; posts in the wrong language; Bahrain hashtags on the Saudi account; too many product types.
  - **5 ideas built on what worked:** a sequel to the best post, a product-first opening with the one feature a customer sees (the name on the mug's curve, the sticker peel, the canvas edge…), the next occasion, a guide worth saving, and before/after.
  - **Ready to copy:** a bio and 3 reply messages in the account's language.
  - **Execute in one click:** «اعتمد في بنك الأفكار» (approve into the idea bank) is free now — the automatic schedule designs the approved ideas in its own slots. «صمّم الآن» (design now) designs one idea immediately into the approval queue. Both follow the normal approval rules, and the ideas are recomputed on the server. Interpretations are labelled as such, and nothing is published from the page.
- **Print studio — «فكرتك للتصميم» (your design idea) and idea suggestions for the AI picture:**
  - A box above «إنشاء الصورة» (generate image) where you describe the scene: subject, angle, light, material.
  - Your idea becomes the core of the picture prompt, and the chosen direction (A/B/C) becomes secondary. The print rules stay: no text inside the picture, the exact crop and the safe margins.
  - The idea is saved with the design, so it appears in the history and is part of the approval fingerprint.
  - «💡 اقترح أفكارًا» (suggest ideas) gives 5 ideas fitted to the activity, the product size and the audience. With an AI key it is one small text call (recorded against the budget); without one, it gives free ready-made ideas per product. Tap an idea to fill the box, then edit it.
- **Fix: Saudi account posts carried #البحرين.** Two Reels on bhfcc.ksa (14 and 18 Nov) went out with Bahrain hashtags. The algorithm gate now removes every Bahrain hashtag from Saudi-market posts (#البحرين, #Bahrain, #هدايا_البحرين…), from the tag list and from inside the caption, and adds #السعودية. The branch phone line is left untouched.
- **Project skills for future development sessions** (`.claude/skills/`):
  - **`fc-dev`** (new) holds this repository's development workflow: local Postgres and Redis, the checks to run before a PR, the phone-sized UI check, the zod-4 and RTL pitfalls that already broke builds, and the branch → PR → green CI → merge → one-click release flow.
  - **`react-best-practices`** is Vercel's 72 React/Next.js performance rules, vendored from `vercel-labs/agent-skills` under MIT and reviewed as documentation only.
  - It sits next to the existing `ig-*` operations skills.
- **GitHub — «هل أدمج؟» (should I merge?) on every pull request:** one comment, updated in place, says ⏳ wait while CI runs, ✅ safe to merge when every check is green, or ⛔ do not merge with the failing job and its log. It works for Dependabot PRs too and needs no repository settings.
- **GitHub — main health:** when CI fails on `main`, an issue «🔴 main معطّل» (main is broken) opens with the failing jobs and what it means; the server will not update to a red version. The first green run closes it.
- **GitHub — one-click release:** Actions → «Publish release» → choose patch / minor / major. It prepares the changelog and version, commits, runs CI on that exact commit, and publishes the tag and Release only when it is green. A server with automatic updates installs it within 10 minutes. It refuses to start when `main` is red or «Unreleased» is empty.
- **Image quality gate for social-media designs** (it already guarded the print studio and EDUCATION MASTER). Every AI scene for a layered design and every extra Reel shot is checked before composing:
  - text the image model drew by mistake (read by vision), softness and exposure;
  - a failing scene is regenerated once with the reason added to the prompt, only within the AI budget;
  - the art director may only choose among passing scenes;
  - the verdict is stored on the design, and the new WARNING check «image_quality» shows the score, re-draws and issues;
  - switch: «فحص جودة الصور قبل التصميم» (check image quality before designing) in AI settings, on by default — one small vision call per picture. Full-AI posters keep their own text and layout check.
- **Several formats per account, with shares:** in the account settings, «عدة صيغ بالتناوب» (several formats in rotation) shows a checklist: Reels, carousel, portrait post, square post, story. Tick one or more and give each a weight; the percentage is shown live, and «مزيج النمو الموصى به» restores 50/25/15/10. Automatic designs follow the chosen shares (last 14 days); «صيغة واحدة ثابتة» keeps one format.
- **Team members (المستخدمون والصلاحيات):** a new page under settings. The administrator adds staff (editor / viewer / admin), changes roles, disables accounts, unlocks locked ones and sets a new password (a strong one can be generated); changing a role, disabling or resetting ends that person's open sessions. The system never removes its last active administrator, and nobody can disable or demote themselves. Every user can change their own password (the current one is required; every session ends). All changes are audited.
- **AI proofreading before drawing** (setting `useAiReview`, now on the AI settings page, off by default): one small text call reads the copy and only definite spelling/grammar mistakes are fixed before the design is rendered. A fix is applied only when it is exact, small and adds no numbers, and Gulf dialect is not treated as a mistake. Anything uncertain is listed for the reviewer in the new «ai_proofread» QC check; usage is recorded against the budget.
- **Per-account daily limit:** failed designs and dry-run previews no longer use the account's quota (the overall cap still counts them, to protect the AI budget); the message says how many designs were made today, when the limit resets (midnight Bahrain) and where to raise it.
- **Tests:** the advisor test no longer depends on the free disk space of the machine running it, so local runs are fully green.
- **Study:** `docs/DEV_ROADMAP.md` lists the findings, what was done in this round, and the next steps.
- **Security — zod 3 → 4.6.7** (fixes the high «memory exhaustion on oversized constrained collections» advisory in the validation library every API request goes through). v4 behaviour changes handled: nested settings groups use `.prefault({})` so their inner defaults are still filled; per-format maps use `z.partialRecord` (v4 records over an enum require every key); edit routes (PATCH accounts/products) use a new `patchSchema()` because v4 `.partial()` fills defaults and would have reset fields the request did not send; guard tests added.
- **Designs built to the algorithm index («مؤشر الخوارزمية»)** — not just scored afterwards: every new design passes an *algorithm gate* before it is saved. Engagement bait is removed, a first line longer than 125 characters is split at its first sentence break (so it shows before «more»), the product keyword (and Bahrain / Saudi Arabia for KSA accounts) is placed in the first two lines for Instagram search, a natural send/save line is added before the call to action when missing, and hashtags are kept at 3–5. The AI's wording is kept — lines are only removed, split or added. The score before → after and every fix are stored on the design and shown on its page; a new WARNING check «algorithm_index» flags designs still below B (70) and names what is missing (e.g. a story's limited reach, a long headline).
- **AI picture quality gate** (print studio + EDUCATION MASTER): every picture is checked for text drawn inside it (vision read), real sharpness (strongest edges vs tonal range — flat illustrations are not called soft), exposure/contrast, and, for cut-outs, margins and real transparency; a failing picture is regenerated once with the reason added to the prompt (only within the AI budget, all usage recorded); with several variants the art director scores them and a passing picture always wins; the studio shows the verdict, score, art-director mark and any auto-regeneration; uploaded client photos get the technical checks only.
- **Reels render faster:** decoded still frames are reused instead of being re-decoded by FFmpeg for every second (#13).
- **Fix — intermittent test failure on `main`:** Metricool «link all brands» picked the free account slot by creation time only; accounts created in the same millisecond came back in random order. The id now breaks ties, so the slot order is deterministic (the CI failure after #13 was this, not the Reels change).
- **CI:** commits on `main` are never cancelled any more (only superseded PR runs are), so every commit gets a real ✓ or ✗ — the server's update check no longer sees «failure» for a run that was merely cancelled; a weekly run on `main` (Sunday 02:17) catches intermittent tests and outside drift; a new check fails when `prisma/schema.prisma` changes without a migration.
- **`bash scripts/freellm.sh` readable in the Hetzner console:** it printed its steps, the dashboard password label and the setup code in Arabic, which that console shows as ◆◆◆; it now prints English there (TERM=linux) like `update.sh`, Arabic elsewhere (`FC_LANG=ar|en`).
- **Releases:** `node scripts/release-prep.mjs X.Y.Z "title"` turns «Unreleased» into the version section and sets `package.json` (both checked by the Release workflow).

## 9.1.0 — 2026-11-18 (releases install themselves on the server)
- **Automatic release deploy** (opt-in): `bash scripts/autoupdate.sh on` once; after that every GitHub Release is installed by the server within 10 minutes — exactly the released tag, through `scripts/update.sh` with all its safety (green CI required, build while running, health check, automatic rollback). A failed release is retried at most every 6 hours; a manual newer version is left alone. `autoupdate.sh off` / status. Guide: `docs/RELEASES.md`.
- **update.sh:** `FC_REF=<tag>` updates to a precise release; the GitHub check compares with the version that actually runs; after a failed build or a rollback the code returns to the running version (the next try checks GitHub again).
- **Instagram safe zone for Stories and Reels (1080×1920):** the logo, the order button and both branch numbers sat under Instagram's own UI (Reels caption / @account / audio, the story reply bar, the top header) and were cut from the 3:4 profile-grid cover — customers did not see the phones. All 1920 layouts (full-AI poster, gold poster, classic, gold frame) now keep them inside y 236–1540, clear of the Reels side icons and inside the grid crop; the AI art still fills the whole frame. The benefit-icon row stays on feed formats only. New BLOCKER quality check «ig_safe_zone». Reel captions moved above the order button.
- **«نشر الآن» for designs marked «فشل» whose final files are complete** (e.g. a late step stopped by low memory): on the design page and in a new section of the approvals queue. Refused when the design was published or scheduled already, or when an earlier attempt is still unconfirmed (no duplicate post), or when a file is missing; the earlier failed attempt keeps its record.
- **Posts log & design page — نشر الآن / تعديل / حذف:** failed posts show the reason and three buttons (phones get a card per post instead of the wide table). «تعديل» works on failed designs too (a new revision with your note). «حذف» deletes a design with its images, video and failed attempts (audited); never a design that is published, scheduled or on its way.
- **One automatic retry when Instagram could not download the file** («The media could not be fetched from this URI» — seen live at 12:00 when the server was overloaded): 30 minutes later, same approved files (SHA-256 re-checked), 30-minute gap kept, at most once per design, not while the kill switch is on; a real rejection is never retried. Notification «إعادة محاولة تلقائية».
- **«مؤشر الخوارزمية»** on every design (and a badge on approval cards): a 0–100 readiness score from the ranking signals Instagram has described publicly — Reels for reach to non-followers, watch time and the first two seconds, sends and saves, originality, keyword search (product + place in the first two lines), 3–5 hashtags, the account's peak hour — each with a concrete tip. A readiness score, not a reach prediction.
- **Engagement bait removed automatically** («منشن صديقك», «اكتب نعم», «لايك إذا…», «tag a friend», «comment YES»…) — Instagram demotes it. Captions now name the product and the place for Instagram search and give people a reason to send or save; carousels make slide 2 a second hook (Instagram re-shows carousels from slide 2).
- **EDUCATION MASTER AI V4.0** (`/education-master`): educational print production — 15 design types (brochure 2×3 panels, poster, worksheet with answer boxes and answer key, flash cards with duplex backs, certificate, mind map, table, cover…), AI content with computed answer keys, mm-exact layout engine (Arabic RTL, Arabic/Latin digits, equations drawn token by token so they never flip), preview with folds / safe margins / compare, real editing + undo, 300-DPI PNG/JPG and a dependency-free multi-page PDF (bleed + TrimBox) re-opened by quality control (PASS/WARNING/FAIL). School projects carry no shop logo, phones or ads. Guide: `docs/EDUCATION_MASTER.md`. Migration `20261118150000_edu_projects`.
- **EDUCATION MASTER V4.1 design:** the visual style now really changes the page (kids, school colourful, luxury frame, minimal, 3D, illustrated, creative; «smart» picks by grade/type, decoration only in margins); auto-fit text chooses the largest font that fills the page without overflowing (up to 170%, manual override); balanced poster/booklet columns; numbered section headings; editor adds/deletes/reorders sections and exercises and switches style/font from the preview.
- **EDUCATION MASTER V4.2 — AI artwork:** a per-project image plan (cover, a background per face, a picture per section by the «الصور» level), professional prompts per visual style, fixed rules (no text inside images — text is always drawn by the engine; Islamic studies without people or faces; no logos), cost shown before generating and checked against the budget, redo one image with «تغيير». Backgrounds fill the page with frosted cards only behind the text; section pictures sit at the top of their section. Single-page posters auto-fit down to 60% so they stay on one page with pictures.
- **EDUCATION MASTER V4.3 — glossy professional brochure** (new default for brochures and posters): sky panels with blue/gold waves, glossy heading pills with a meaning-matched vector icon, cream gold-rimmed cards with blue dot bullets, a designed cover (subject band, «درس» tag, framed title, full cover painting, name/class fields with icons — never an invented name), vocabulary tables and captioned picture grids (one AI picture per caption, caption is real text). Free panel height is spread between sections; headings keep their size while reading text auto-fits up to 150 %. Content generation adds a vocabulary table and a picture grid where the lesson has them.
- **Form quick picks:** subject, grade and lesson-idea chips (free text still allowed).
- Fix: wrapped Arabic lines ended on the LEFT (Pango mirrors alignment for right-to-left paragraphs) — now they end on the right in every design.
- **PRINT DESIGN STUDIO V6.0** (`/print-studio`, phase 1): a central product database (11 categories, 100+ products in 12 production families with their own bleed/safe/resolution/requirements/rules; the shop disables what it does not offer), request understanding (product, size and contacts from free text — never invented; material suited to the use; resolution from viewing distance; missing essentials ⇒ preview only), activity-based identity (13 industries), three scored creative concepts, a family-aware layout engine (two-sided cards, tri-fold with the narrower fold-in panel, book cover with computed spine, roll-up base zone and distance-sized headline, die/kiss-cut stickers with white ink, mug wrap with seam zones and mirrored copy, transparent apparel art with underbase, stamps), automatic text contrast against the real background, a CMYK print PDF with TrimBox/BleedBox and real spot-colour CutContour/KissCut/Fold vectors, cut SVG / white ink / editable source / job ticket, mockups from the design's own pixels, six-level QA (PASS / NEEDS_REVISION / BLOCKED / NOT_VERIFIED), approval hash + versions + undo, and a separate printer ad from the approved design (approvals queue). Migration `20261119090000_print_projects`. Guide: `docs/PRINT_DESIGN_STUDIO.md`.
- **EDUCATION MASTER — lesson suggestions by grade:** general topics now follow the subject AND the school stage (KG, 1–3, 4–6, 7–9, 10–12), labelled «not the official list»; admins enter this year's official lessons (2026-2027) per subject and grade from the textbook contents in Settings — shown first to everyone as «📘 دروس كتاب الطالب».
- **Curriculum bulk import:** all subjects and grades at once from text («# subject | grade» + one lesson per line) or CSV, with a preview and errors for unknown subjects/grades; download all saved lists as an editable file.
- **PRINT DESIGN STUDIO — finishing plates:** gold/silver foil, spot UV and emboss/deboss now produce their own pixel-aligned 100 % black plate (PNG + grey PDF with the same media size and TrimBox) for the chosen elements (logo + headline / logo / headline / name), a tinted preview, and QA (≥ 8 pt, ≥ 10 pt for emboss; trapping left to the press operator).
- **PRINT DESIGN STUDIO — supplier dieline (SVG):** cut / crease / perforation / glue are read by layer name or line colour/dash, converted to real millimetres (relative paths, curves and arcs supported), panels found between creases inside the knife line; the box is designed flat on it (front / back / sides), art kept inside cut + bleed, creases and perforations exported as spot vectors; the 3D mockup uses the real front panel. Packaging is production-ready once a valid dieline is uploaded; unusable files are refused with the reason.
- **PRINT DESIGN STUDIO — resolution for large formats:** before generating, the picture area in mm and the AI picture's effective PPI there against the target and the eye's limit at the viewing distance (good / acceptable for the distance / low) plus the pixels a real photo needs; professional upscale (Lanczos + light sharpening, ×2–×4) that smooths pixels while QA keeps measuring the original; upload a high-resolution photo instead of the AI picture. QA accepts — and says so — a picture below the target but above what the eye can resolve at the stated distance.
- Fix: the roll-up / banner form could not be submitted with the default 3 m viewing distance (number field step); dates in the print projects list rendered differently on server and browser.
- **PRINT DESIGN STUDIO — online client proof:** a secret 14-day link (shared via WhatsApp) where the client, without logging in, sees the mockup and every face watermarked «PROOF» with the specs and a checklist, then approves (by name) or requests changes (with a note); the shop is notified, approval approves that exact design version, edits make the old link refuse a decision, decisions are rate-limited and audited as `client:<name>`. Migration `20261119150000_print_proof`.
- **PRINT DESIGN STUDIO — AI pictures for every size:** art direction per box (closest model canvas to the box's proportions, crop-safe composition, a style per product family, transparent background for stickers and apparel, automatic background extension for extreme proportions such as 3:1 banners), quality tier with the suggested one per size, 1–3 variants to choose from, costs shown first; die-cut stickers use the AI cut-out as their hero; the image request passes `background: transparent` (dropped automatically if the model rejects it).
- **PRINT DESIGN STUDIO — quote from the design:** the item line is written from the real specs, quantity / unit price / design fee / discount are typed by the shop (never priced by the system), saved on an existing or new customer in «العملاء والطلبات» (numbered quote, status QUOTED, value), printable quote page, and one WhatsApp message with the quote, the proof link and both branches. Migration `20261119180000_print_lead`.
- **PRINT DESIGN STUDIO — production tracking & job sheet:** stages queued → printing → finishing → ready (WhatsApp «your order is ready» to the linked customer) → delivered (customer marked WON), only after approval + exported files, with notes and history; a printable workshop job sheet (specs, quantity, material, finishes, customer & quote, approval, QA, thumbnails, files, stages, signatures). Migration `20261119200000_print_production`.
- Fix: saving a quote (quantity) no longer voids a design approval — quantity is commercial, not part of the design fingerprint.
- **PRINT DESIGN STUDIO — orders board:** jobs per production stage and the lists that need a person (changes requested, proofs awaiting the client, approved without files, stuck 2+ days, ready not collected), each opening its project; a daily 09:15 reminder only when something is due.
- **PRINT DESIGN STUDIO — monthly report:** delivered value and orders (Bahrain month), best-selling products, proof approval rate, approval→delivery turnaround and progress towards the monthly sales target; values only from typed quotes (orders without a quote are counted, never valued).
- Fix: the font library loaded through the Next.js bundler (`opentype.js` default import was undefined in website routes).
- **Readable in the Hetzner web console:** that console cannot draw Arabic (◆◆◆), so the update scripts print English there (TERM=linux) and Arabic everywhere else (`FC_LANG=ar|en` to choose).
- **`bash scripts/swap.sh`** (one time): adds swap memory (4 GB on small servers, kept after reboot). Seen live: the update build ran out of memory and the kernel killed a running reel render (ffmpeg). `update.sh` warns when memory is low and there is no swap.
- **CI:** test failures are annotated on the exact lines in GitHub; pull requests get GitHub's dependency review (blocks high/critical vulnerabilities and incompatible licences).

## 9.0.0 — 2026-11-18 (sales, growth program, real-work posts, professional GitHub)
Everything since 8.19.0. Migrations are additive and run automatically on update.

### Sales and customers
- **«العملاء والطلبات»** (`/leads`): comments that ask to buy or ask the price become leads automatically. Phone, WhatsApp and branch-visit customers are added by hand, with the account that brought them. Pipeline New → Contacted → Quote sent → Ordered / Not completed, with follow-up dates, order value and lost reason. Migration `20261118090000_leads`.
- **Sales playbook:** the next best step for every customer, with a ready WhatsApp message (Bahraini Arabic, or English when the customer wrote English): first reply, quote, follow-ups on day 2 and 5, thanks, past-customer offer, re-engage. A person sends it; the step is logged.
- **Quotes:** the owner types items and prices (the system never prices). Numbered quotes, validity and terms from settings. A printable branded page (`/q/[id]`) to save as PDF.
- Monthly sales target with pace, open-quote pipeline, past customers due for a new offer, and a daily follow-up reminder. Migration `20261118120000_sales`.

### Growth and analytics
- **Analytics** with real per-account Metricool numbers and rule-based advice.
- **Smart posting plan:** rhythm and format mix per account from real reach.
- **30-day growth program** (`/growth`): diagnosis, modest targets, four weekly phases followed by the designer, progress and weekly notes.

### Content
- **«أعمال منجزة»** (`/portfolio`): branded posts from real photos of delivered jobs (no AI image, client named only with consent).
- Banned phrases, publish-now with a recorded QC override, Reels for reach (burned-in captions, seamless loop), 25 new occasions, voice-over pronunciation, reference design per format, comments triage with safe drafts, campaign multi-choice.
- Production pipeline V6: concept rubric, vision layout inspection, verified-text fallback, foreign-text guard, PNG export.

### Engineering
- **CI:** the integration suite runs on 3 parallel runners; one summary check `ci-ok`.
- **Safe updates:** `scripts/update.sh` waits for the GitHub `ci-ok` check of the new version and refuses a red one (`force` skips it).
- **Releases:** a GitHub Release for every `vX.Y.Z` tag, with notes from this file.
- Arabic issue forms (bug, feature, design problem); private security reporting link.

## 8.19.0 — 2026-11-12 (automatic Google Business Profile)
- New per-account settings: `gbpAuto` and `gbpPerWeek` (default 2), shown as a section in the account form.
- Automatic designs add the Google channel by themselves when all of these hold:
  - the account opted in;
  - Google Business is linked in Metricool;
  - the format suits Google: feed or square → update, reel → gallery;
  - the weekly cadence isn't reached.
- It reuses the Google-safe satellite job: no phones, no hashtags, plus the local branch line. A Google failure never fails the Instagram post.
- **Advisor:** "Google Business not linked", with per-branch steps. Found live: none of the 15 brands has Google Business linked.
- **Live bug fixed:** Metricool reports Google Business as `networksData.gbpData`, which the parser didn't recognise, so a linked profile looked unlinked. Seen on bhfcc.mugs. A test uses the live shape.
- Migration `20261112170000_gbp_auto` (additive).

## 8.18.0 — 2026-11-12 (same-brand cross-promotion; campaigns respect the posting window)
- **Cross-promotion stories:** when a feed post, reel or carousel is verified published, the accounts chosen for it get a branded story.
  - The story reads «جديد على حسابنا @handle», with the post image in a gold frame, the headline and a CTA, in the target account's language.
  - It is transparent, with no fake comments or likes.
  - It goes through approval or autonomy, the 30-minute gap, a per-target daily cap (default 2) and a delay (default 45 minutes).
  - Stories and promotions are never promoted.
  - Settings and per-account links are on the schedule page, with a suggested-linking button (niche accounts → general accounts).
- **Campaign slots outside an account's posting window** (for example 23:30 or 00:00) now move to the window's next opening.
  - Duplicates that land on the same opening collapse into one.
- Migration `20261112150000_cross_promo` (additive).

## 8.17.1 — 2026-11-12 (editable campaigns)
- **Campaigns can be edited** (`/campaigns/[id]`), with every field pre-filled.
  - Saving keeps the run history and recomputes the next slot.
- **Copy** a campaign: the copy starts paused, ready to adjust for another occasion or set of accounts.
- **«ترقية الحملات القديمة»** (upgrade old campaigns), with a preview:
  - silent audio → the reel audio from settings;
  - no design method → «تلقائي» (auto);
  - per-account format → smart mix.
  - Explicit choices are kept.
- Campaign list shown as responsive cards, with the accounts, schedule, next run and runs fully visible on mobile.

## 8.17.0 — 2026-11-12 (professional designs for automatic posts)
- **Colour story with three sources, in order:** occasion, then audience, then **product category** (new).
  - The new source covers automatic posts, which usually have no occasion or audience.
  - It covers 11 category families: weddings, kids and schools, corporate, restaurants, gifts and mugs, luxury, perfumes and candles, sports, initiatives, home businesses, signage.
- **Automatic designs** (schedule, campaigns, n8n) that don't choose a method or style now use settings:
  - `ai.autoRenderMode`, default `auto`: full signature AI poster for stories and reels on approval-mode accounts, verified layers on autonomous ones;
  - `ai.autoDesignStyle`, default `fc_signature`.
  - Both are editable in the AI settings.
- Tests keep the layered path explicitly. A new test covers the production default.
- 234 tests passing.

## 8.16.1 — 2026-11-12 (outside-post watch; archive misconfiguration shown)
- **Posts made outside the system are now detected:** every 2 hours the worker reads, read-only, each connected brand's Metricool planner from 12 h back to 48 h ahead.
  - Posts that this system did not create are reported **once**, with their concrete risks: outside the posting window, banned price or claim phrases, speed or delivery promises, missing text.
  - The report goes to the alerts page and to Telegram through n8n.
  - Found live: 5 posts on bhfcc.india added from another tool, including 01:00 and 06:00 slots and a "fast" promise.
- **Advisor:** an n8n archive with no Drive folder now shows up as a recommendation, instead of the template skipping silently.
- Metricool adapter: `listScheduled`, parsed from the live response shape.

## 8.16.0 — 2026-11-12 (the owner's signature style plus a colour story by occasion and audience)
- New default design style, **«توقيع المطبعة الإعلاني»** (the print shop's ad signature). It was extracted from the owner's own designs (style only):
  - glossy 3D look, hero product on a warm wooden table in a softly blurred real setting;
  - plant, books, pencils, gift box and swatch-fan props, golden bokeh;
  - Pixar-style cartoon artwork on the products, and a smiling child giving a thumbs up for education.
- **Full-AI posters add the signature language:**
  - 3D metallic-gold headline and a gold ribbon banner for the tagline;
  - navy circular benefit badges with gold rings, gold ribbon swooshes;
  - the Bahrain skyline with the Bahrain World Trade Center, and a waving Bahrain flag (Bahrain accounts only).
  - The logo, CTA and phone numbers are still deterministic layers.
- **Colour story:** it follows the occasion first, then the audience, for example National Day in red and white, Ramadan in midnight purple with lanterns, weddings in ivory, blush and champagne, schools in sky blue and yellow, companies in navy and brushed gold.
  - It applies to the AI-poster decoration and to the colour theme of the layered templates.
  - A specific style chosen by the user always takes precedence.

## 8.15.2 — 2026-11-12 (n8n: re-running setup keeps the Google accounts)
- Problem seen live: re-running `n8n-setup.sh` re-imported the templates and cleared the Google accounts chosen in the editor, which caused "Credential not configured".
  - Now `deploy/n8n/link-credentials.js` links each template's empty credential references to the existing n8n credentials (by type) before importing.
- Templates 06 and 04 are published automatically when Drive and Sheets are connected and the folder and sheet IDs are set.
- Template 06's Drive node is set explicitly to File → Upload.

## 8.15.1 — 2026-11-12 (fix: Malayalam and Indic hashtags)
- **Live bug found in Metricool:** a Malayalam carousel on bhfcc.india was published with broken hashtags («#ബഹ #ക #വ #സ») and a stray line of fragments in the caption.
  - Cause: the hashtag pattern excluded combining marks (vowel signs, virama) and ZWJ/ZWNJ.
  - Fix: hashtags now keep `\p{M}` and ZWJ/ZWNJ, and text de-duplication keeps combining marks too.
  - A regression test uses the real example.

## 8.15.0 — 2026-11-12 (direct Google Drive archive, no n8n or Google Cloud)
- Each verified publication goes to the owner's own **Google Apps Script** web app, through the durable outbox (with retries).
  - The payload carries signed links to the exact published files.
  - The script saves the files and the caption into a folder per account and appends a row to the «published» sheet.
  - It skips duplicates and downloads only from the system's host.
- In the dashboard (Integrations): a card to save the script URL (encrypted), test it and archive the last 20 posts.

## 8.14.1 — 2026-11-12 (Google Drive and Sheets from the dashboard)
- The n8n settings take the **Drive archive folder link** and the **Google Sheets link**, stored as their IDs.
- `scripts/n8n-setup.sh` writes them to `.env` as `GDRIVE_FOLDER_ID` and `GSHEET_ID`, so nothing has to be typed in the console.
- Templates 04 (ideas) and 06 (archive) read the sheet from `$env.GSHEET_ID`, so the sheet no longer has to be picked by hand in n8n.

## 8.14.0 — 2026-11-12 (occasions calendar)
- New page **«تقويم المناسبات»** (occasions calendar).
  - It shows the Bahraini and Gulf occasions of the next 5 months, each with its peak date, a countdown, its publishing window and suggested categories.
  - **«إنشاء حملة لهذه المناسبة»** (create a campaign for this occasion) creates a campaign in one click:
    - it runs from the start of the window to one day after the peak, daily at the best time;
    - format, style and method are set to auto;
    - the category is optional;
    - accounts are filtered by market (Saudi occasions → the Saudi account).
- **New occasions:**
  - **القرقاعون** (Gergaoon, 15 Ramadan);
  - **يوم المرأة البحرينية** (Bahraini Women's Day, 1 Dec);
  - **يوم المعلم** (Teachers' Day, 5 Oct).
- 2026 lunar dates were added.
- Fix: a Saudi-market account now gets the Saudi dialect for its voice-over, not the Bahraini one. The market mapping was wrong.

## 8.13.2 — 2026-11-12 (recommended one-click setup)
- New card on the schedule page: «⭐ الإعداد الموصى به» (recommended setup).
  - A preview comes first, then one click applies it to every account: every 7 hours (daily cap 4), smart format variety, and niche categories matched to the account name.
  - Name matches: mugs, education, gifts, stickers, business, occasions, advertising, india.
  - Main-brand and branch accounts keep all products.
  - Accounts that already have chosen categories or products are not changed. The action is audited.

## 8.13.1 — 2026-11-12 (minimum gap between posts)
- **At least 30 minutes between any two posts on the same account**, set by `publishing.minGapMinutes`.
  - The rule applies whatever created the post: a campaign, the automatic schedule or a manual publish.
  - The slot is chosen under a per-account PostgreSQL advisory lock, so simultaneous requests cannot pick the same minute.
  - A queue-delayed post that is moved forward also keeps the gap.
  - A failed post frees its slot.
  - A moved post is audited with `requestedFor` and `movedForGap`.
- Found live in Metricool: bhfcc.mugs had two stories at 19:01.

## 8.13.0 — 2026-11-12 (Bahraini and multilingual voice-over)
- **23 speaker personas** in 12 groups:
  - commercial announcers, female, male, youth;
  - children: pitch and formant shift with rubberband;
  - elderly: slower and deeper;
  - broadcasters, sports commentator, hakawati storyteller, theatrical, comedy, folk, documentary narrator.
- **73 languages and dialects** in 19 audience groups:
  - **Bahraini is the default.** It has accent instructions: ق pronounced as "g", Gulf intonation, Bahraini vocabulary.
  - Other Gulf and Arab dialects, plus Indian, Pakistani, Bangladeshi, Filipino, Nepali, Sri Lankan, African, European, Russian/Eurasian, Turkish, Iranian, Chinese, Japanese, Asian, Latin, American, Canadian and Australian varieties.
  - Each entry carries an honest expected-quality label.
- **Native script per reel:** the AI writes the voice-over in the chosen dialect, sized to the reel length and faithful to the verified copy.
  - Digits, links and hashtags are removed. A script with price or claim language is rejected, and the verified copy is spoken instead.
- **«تلقائي» (auto):**
  - the persona follows the product category and rotates (e.g. sports → commentator, kids → child voices, weddings → elegant female);
  - the dialect follows the audience or market.
- **«استماع لعينة» (listen to a sample)** in the AI settings: a real sample for any persona × dialect (≈ $0.003).
- Every reel records the persona, dialect and spoken script.

## 8.12.0 — 2026-11-12 (professional reel video and sound)
- **Video quality:**
  - camera moves with cosine easing;
  - lanczos upscaling;
  - cinematic transitions only (fade, smooth, fade-black) and a new "slow rise" move;
  - text slides in with cubic ease-out.
- **Mastering:**
  - BT.709 colour tagging and conversion, so colours are no longer washed out on phones;
  - light sharpening, debanding and a fine temporal grain;
  - x264 CRF 17 `slow`, aq-mode 3, capped at 8 Mb/s.
- A short Veo clip is slowed gently (up to 1.25×) instead of freezing before the end card.
- **Sound:**
  - all audio is 48 kHz, 192 kb/s, normalised to −14 LUFS;
  - **licensed music library:** upload with a required licence note and mood. Tracks rotate least-recently-used, and the mood follows the design style;
  - **AI voice-over** (OpenAI TTS, 5 voices) reads only the verified headline, badge, line and CTA (no digits or links), with automatic music ducking;
  - **sound design:** hook impact, whoosh before each transition, text pops, end-card chime.
  - Silent and Instagram-audio reels stay silent.
- The default reel audio is a setting (`ai.audio.defaultReelAudio`, default: upbeat).
- Every reel records the track, its licence and the voice script.
- Migration `20261112120000_audio_library` (additive).

## 8.11.0 — 2026-11-11 (varied professional designs, campaign category, «تلقائي»)
- **Art-direction engine:** every design gets a professional recipe: composition × lighting × lens, plus the poster layout for full-AI posters.
  - The recipe rotates per account (least recently used of the last 12), so consecutive designs differ in angle, light, setting and layout.
  - The recipe is recorded on the ad.
- Full-AI posters now use **6 layout families**: centred badge, split, oversized type, framed card, diagonal, editorial.
  - Their decoration follows the chosen colour theme instead of always navy.
- The brief no longer forces the same table and bokeh. It asks for a specific setting and props each time, with stricter product-accuracy wording.
- **Campaigns:**
  - «تلقائي» (auto) for format (growth mix), idea, design style (rotation) and design method;
  - a **product category** selector (auto = all categories).
- **Catalogue:** bundled ready-made CSV (`deploy/catalog`): 93 products, services and bundles in 18 categories, importable with one tap.
- **Telegram:** direct test button with clear reasons. Auto-detect now replaces a wrong chat id.
- **n8n:** a wrong webhook path is flagged.

## 8.10.0 — 2026-11-11 (large catalogue: 500+ products and services)
- **Bulk import** from CSV (Excel «CSV UTF-8») or a shared Google Sheets link:
  - Only the **category + name** are required. Arabic and English headers are both accepted (الفئة/الاسم/الاسم بالإنجليزية…, or category/titleAr/titleEn…). Lists are separated with `|`.
  - Missing fields are filled automatically: audience, occasions, image description, messages.
  - **Preview first** (nothing is saved): new, updated, new categories, rejected rows with line numbers. Then «تأكيد الاستيراد» (confirm import).
  - Upsert by code (slug), so re-importing the same sheet updates and never duplicates. Arabic-only names get a stable code. Missing categories are created.
  - Rows with unverified claims or prices in their messages are rejected (same QC rules).
  - Up to 5,000 rows per file, written in batches of 100.
- **Export / template:** `/api/products/export` produces a CSV that the importer reads back unchanged.
- **Products page:**
  - server-side search, filter by category and status;
  - 50 per page;
  - bulk activate/deactivate.
- **Account form:**
  - allow whole **categories** (includes products added later);
  - a searchable product list instead of hundreds of checkboxes.
- **Smarter rotation:** an account never repeats any of its last 10 products (fewer for small catalogues).
- Index `products(categoryId, active)`. Migration `20261112090000_catalog_scale` (additive).
- Bug found by the new tests and fixed: Arabic headers containing «إ/أ» were not recognised.
- Tests (203 passing): CSV parsing (Arabic headers, defaults, stable codes, duplicates, claims, Sheets link), 600-row import (preview writes nothing, commit, re-import updates, export round-trip), category allowance, rotation over 600 products.

## 8.9.1 — 2026-11-11 (n8n one-command setup)
- **Dashboard Telegram section:**
  - bot token (encrypted), chat id and allowed user ids;
  - **«اكتشاف تلقائي»** (auto-detect) reads the bot's updates to find the chat id and the user's id;
  - the webhook URL is pre-filled with the internal address.
- **`bash scripts/n8n-setup.sh`:**
  - takes or creates the secrets from the encrypted settings, so nothing with `_` or `:` has to be typed in the console;
  - updates `.env` safely and generates `N8N_ENCRYPTION_KEY`;
  - starts n8n and reloads Caddy;
  - imports the templates and the Telegram credential (fixed id), publishes 05/01/03/02, and sends a test event.
- The templates are mounted in the n8n container at `/templates`. The archive branch runs only when `GDRIVE_FOLDER_ID` is set, so there are no error alerts before Google is connected.
- Verified against n8n 2.35.7: credential import, import of all 6 templates, publishing 4 of them, the helper output and the `.env` merge.

## 8.9.0 — 2026-11-11 (quality per format, interval and no-approval publishing in bulk)
- **Image quality per format** (`ai.qualityByFormat`):
  - Stories default to **low** (they live 24 h); every other format follows the global quality.
  - Budget checks and recorded costs use the effective quality.
  - The AI settings page shows a selector per format with the cost per design, plus «تطبيق الموصى به» (apply recommended).
- **Schedule page, bulk actions on the selected accounts:**
  - **publish every 5 / 7 / 9 hours** (or any value). The daily cap follows the cadence, and a shorter interval takes effect soon instead of after the old wait.
  - **«نشر بدون موافقة للمحدد»** (publish without approval): autonomous authorisation for linked accounts only, audited. It needs the `autonomy:authorize` permission and warns when the global mode is not «ذاتي». «إرجاع للموافقة اليدوية» returns accounts to manual approval.
- **Account form:** the interval is now chosen in hours.
- Tests: quality per format (low for a story, medium for a feed post) with recorded costs; HTTP smoke test of the bulk interval and autonomy. 190 tests passing.

## 8.8.2 — 2026-11-11 (enabling auto-publishing)
- The schedule page has a new section **«الحسابات المسموح لها بالنشر الآلي»** (accounts allowed to auto-publish): tick accounts, or use «تحديد كل المرتبطة» (select all linked), then «السماح بالنشر الآلي للمحدد» (allow selected) in one click. Previously each account had to be opened separately.
  - Accounts without a verified Metricool connection are never enabled. The reason is reported per account.
- The ambiguous label «غير مرتبط/غير مفعّل» is replaced by the exact reason for each account:
  - not linked to Metricool;
  - connection broken (status);
  - emergency-paused;
  - «مرتبط ✓ — النشر الآلي غير مسموح بعد» (linked, auto-publishing not allowed yet).
- The scheduler text now says 7 hours.
- HTTP smoke test: start → NO_ACCOUNTS; bulk enable → 2 changed, 1 unlinked skipped with reason; start → on.

## 8.8.1 — 2026-11-11 (fix: «الموجز لا يطابق المخطط: String must contain at most 30 character(s)»)
- **Root cause:** the text model sometimes writes a CTA longer than 30 characters, or other over-long fields. Strict schema validation then rejected the whole brief. Retries repeated the same mistake, so the design failed with no media.
- **Fix:** `normalizeBrief` fits fields to their limits before validation.
  - Text is cut at a word boundary.
  - Captions drop whole trailing lines, never half a sentence.
  - Hashtags and slides are capped.
  - An over-long or missing CTA is replaced by the official CTA, which is what the design uses anyway.
- The JSON schema descriptions now state the limits, so the model rarely exceeds them.
- A genuinely broken reply now gives an Arabic, field-specific message instead of English Zod text.
- New **«إعادة التوليد بنفس الإعدادات»** button on failed designs.
- Regression tests reproduce the exact error. 189 tests passing.

## 8.8.0 — 2026-11-11 (competitor analysis)
- **New تحليل المنافسين page:**
  - benchmark: followers, growth, posts per week, Reel share, average interactions, engagement rate, sample size, and our own row;
  - Reel vs feed interactions;
  - best hour and best day (each needs at least 3 posts);
  - top 10 posts;
  - themes from the top quarter, hashtags, and **content gaps**;
  - data-backed competitive recommendations;
  - original ideas inspired by the market (no copying), with one click to the create page.
- **Sources:**
  - Metricool Instagram competitors: a daily read-only pull, with tolerant parsing and endpoints that still need live verification;
  - **CSV export import**, with flexible English/Arabic headers, BOM and `;` support, and same-day merging.
  - Instagram is never scraped.
- **`CompetitorSnapshot` table** for growth trends.
- **Advisor rules:** no competitor data; stale data.
- **n8n:** `GET /competitors`.
- A test caught a design flaw: the day×hour grid was too sparse for local accounts, so a "best time" could never appear. Hour and day are now analysed separately.
- 184 tests passing.

## 8.7.0 — 2026-11-11 (Google services)
- **Google Business Profile** (channel `gmb` via Metricool):
  - an image design is sent as `publication` (text ≤ 1500 + cover image); a Reel is sent as `photo` (video to the gallery, no text).
  - A separate **satellite job**: Google rejects posts containing phone numbers and ignores hashtags, so the Google copy has neither and adds a local line naming both branches.
  - Satellite jobs never change the advertisement's state (`ad-state.ts`).
  - `PublicationJob.networks` and `PublicationJob.primary` were added.
- **YouTube Shorts:** title capped at 100 characters, tags taken from the hashtags, category, AI-content declaration.
- **Google Drive + Sheets archive** (n8n template 06, called by 01 for every verified publication): the exact published files plus a log row. The file download and naming were verified in a real n8n 2.35.7. Live test finding: n8n 2.x requires the sub-workflow to be published.
- Profile parsing detects a linked GBP. The posts log shows the networks per job and marks companion copies.
- Docs: `docs/GOOGLE_SERVICES.md`.
- 175 tests passing.

## 8.6.0 — 2026-11-11 (professional diagnostics and advisor)
- **Advisor engine** (`src/lib/ops/advisor.ts`):
  - deterministic rules over real data, with no AI cost and no invented numbers;
  - every recommendation has a severity, a category, the evidence (real counts), why it matters, ordered fix steps and a link to the screen where it is fixed.
- **Rules:**
  - Reliability: worker down; disk space (nearest existing folder).
  - Publishing: stalled despite automation; UNKNOWN jobs; failure rate with the top 3 error reasons; kill switch.
  - Content: recurring QC failures mapped to concrete fixes for 16 checks; dry-run; approval backlog; low approval rate; product repetition per account.
  - Growth: story-only accounts; missing metrics; weak Reel hooks (skip rate); zero saves and shares; statistically confirmed patterns; small samples.
  - Cost: month-end budget projection; cost per verified post.
  - Integrations: Veo selected without a key; broken connections; failed Metricool check; dead n8n deliveries.
  - Security: HTTP in production; many admins; autonomous publishing.
- **Health score** 0–100 with grades A–F (critical −25, high −10, medium −4, low −1) and a daily snapshot (06:50) for a 60-day trend.
- **Performance indicators:**
  - designs, QC pass rate, approval rate and publish success rate;
  - verified posts, pending approvals and average engagement;
  - cost per design, cost per verified post, and month spend vs projection.
  - A KPI with no data shows "—", never 0 or 100.
- **New technical checks:** disk free space and database size.
- **Redesigned diagnostics page:**
  - score gauge, severity counts and trend line;
  - KPI tiles;
  - recommendations grouped by category, with high and critical ones open by default;
  - the technical checks table.
- **Elsewhere:** `/api/diagnostics` and the n8n diagnostics endpoint include `advisor`. The n8n morning check adds "today's priorities". `ig-health` / `cli health` print the score and recommendations.
- 172 tests passing.

## 8.5.0 — 2026-11-11 (n8n, professional)
- **Reliability:**
  - `Idempotency-Key` on POST /generate and /decision: a replay returns the first response, and concurrent duplicates get 409.
  - 404 from n8n (workflow inactive or starting) is retried instead of being marked dead. This was found in a live n8n test.
  - Failed events can be resent per event or in bulk from the dashboard.
  - `GET /deliveries?since=` for catch-up.
- **Events:**
  - `ad.rejected`
  - `approvals.reminder`: hourly, once per design that waited longer than N hours
  - `daily.digest`: 21:05 Bahrain
  - `system.alert`: every new warning or error notification is bridged, except codes that have a dedicated event
- **API:**
  - `GET /ads` (signed previews)
  - `GET /ads/{id}`
  - `POST /accounts/{id}/pause` (off by default, audited as `n8n:<user>`)
- **Templates** (regenerated from `deploy/n8n/generate_templates.py`):
  - the events router now de-duplicates by delivery id and formats every event;
  - one Telegram bot handles both buttons and commands (`/pending`, `/status`, `/report`, `/pause`, `/resume`), restricted to allowed users;
  - a new error workflow, set as `errorWorkflow` on all the others;
  - API auth now comes from `.env` (`FC_API_TOKEN`), so no n8n credential is needed for the API.
- **Operations:**
  - n8n execution pruning (14 days; failures kept), proxy hops and file-permission hardening in compose;
  - `backup.sh` includes the n8n volume;
  - diagnostics shows n8n health (dead or delayed deliveries, last success).
- Verified live against n8n 2.35.7: the bot commands against the real API, event formatting, de-duplication of a redelivered event.
- 166 tests passing.

## 8.4.0 — 2026-11-11 (Gemini Veo AI video for Reels)
- **Gemini API / Veo connector** (`src/lib/ai/veo.ts`):
  - image-to-video at 9:16, 4/6/8 s, 720p or 1080p;
  - long-running operation with polling, then an authenticated download;
  - error mapping: AUTH, QUOTA, SAFETY (filtered outputs), TIMEOUT, NETWORK;
  - first-frame image falls back to the alternative REST field format when the API rejects the first one;
  - a free `verify()` that lists the Veo models available to the key.
- **Pipeline:** with `videoEngine = veo`, the AI product scene is the first frame of the Veo clip. The FFmpeg renderer uses the clip as the moving base, adds a contrast shade, the deterministic verified overlays (logo, headline, badge, CTA, both phones) and the 3 s end card, and keeps Veo's native audio (unless music was chosen). The output is a 1080×1920 H.264/AAC MP4. The raw clip is kept as `SOURCE_VIDEO`.
- **Cost controls:** price per second (editable), up-front budget check, a daily Veo limit, and usage recorded as `kind = video`. Dry-run never calls Veo.
- **Fallback:** if Veo fails, an FFmpeg reel is still delivered. It is flagged by the QC warning `ai_video` and a `VEO_FALLBACK` notification, so a substitution is never silent. The fallback can be turned off.
- **UI:**
  - AI settings → Gemini Veo: encrypted key, model, duration, resolution, price, daily limit, native audio, fallback, and a free "verify key & model" button.
  - Create page: a «محرك الفيديو» selector.
- 161 tests passing.
- **Not verified against the live Gemini API:** this environment has no Gemini key, and Google's docs domain is blocked here. Model ids and price are settings for that reason.

## 8.3.0 — 2026-11-11 (Instagram carousels)
- New format `IMAGE_CAROUSEL`. Each post has 5–6 slides at 1080×1350:
  - the designed cover;
  - 3–4 useful content slides, with a large number, title and body on a blurred backdrop of the same product, a vector swipe arrow, and both branch numbers on every slide;
  - a final slide with save & share, the official CTA and both branches.
  - The audit measured zero shares and one save with single images; carousels are the format built for saves and shares.
- The AI brief returns `slides` for carousels. Missing slides are topped up with truthful generic slides (no prices, times or promises). The dry-run preview builds slides from the approved product messages.
- QC blocker `carousel_slides`: 5–10 images, every text fits, no missing glyphs, no overlap. While building this, QC caught that the Arabic font has no "←" glyph, so the arrow is now drawn as a vector.
- Approval binding covers the whole bundle: SHA-256 of the ordered file hashes. The publisher re-hashes every slide; one modified slide blocks publishing.
- Publishing sends all images in order in a single Metricool post (an Instagram carousel). Networks without carousel support are reported as unavailable.
- The growth mix is now 50% Reels, 25% carousels, 15% feed, 10% stories.
- The dashboard shows the slide strip on the design page. The n8n event includes `slideUrls`. The CLI pre-publish check verifies every slide.
- 154 tests passing.

## 8.2.0 — 2026-11-11 (content engine + n8n)
### Content generation
- **Seasonal content planner:** when the occasion is left on automatic, the system picks a timely one:
  - Bahrain National Day, New Year, Mother's Day, graduation, back to school and wedding season;
  - Ramadan and both Eids, using astronomical dates for 2027–2029;
  - Saudi National Day only for the KSA account;
  - Diwali and Onam only for Malayalam/English accounts.
  - Seasonal posts become more frequent near the peak (80% in the last 3 days), so feeds stay varied.
- **Content-angle rotation:** never one of the last 3 angles used on the account. Automatic choices are recorded (`direction.autoPicked`), so analytics can compare them.
- **Caption quality check** (QC WARNING, never blocks): hook ≤ 125 characters, short body, clear CTA, ≤ 5 hashtags, light emoji use. Stored captions keep at most 5 unique hashtags.
### n8n
- Durable, signed (HMAC-SHA256) event outbox with retries. Events:
  - `ad.ready_for_review` (with a signed image link)
  - `ad.approved`
  - `publication.scheduled`
  - `publication.published`
  - `publication.failed`
  - `publication.unknown`
  - `connection.lost`
  - `report.weekly` (Sunday 08:40)
- Token-authenticated inbound API `/api/integrations/n8n/*`:
  - accounts, generate, reports, diagnostics, events;
  - decision (approve/reject), off by default. It uses the same guarded approval with SHA-256 binding.
- Dashboard: n8n settings, one-time secret and token generation (stored encrypted), a test event, and the delivery log.
- Optional `n8n` service in docker-compose on the same server (`--profile n8n`), plus a Caddy route `n8n.<DOMAIN>`.
- 4 importable workflows in `deploy/n8n/`:
  - events → Telegram, with approve/reject buttons;
  - Telegram approvals, restricted to allowed users;
  - morning health check;
  - Google Sheets ideas → designs.
- A test runs the template's own signature code against the server's signing.
- 149 tests passing.

## 8.1.0 — 2026-11-11 (data-driven growth update)
Based on a real Metricool audit of the 15 brands (`docs/ACCOUNT_AUDIT_2026-11.md`):
- **Reel hook opening** (default on): headline, product badge and logo are visible on frame 0, and the first scene opens with a fast punch-in. Measured skip rates were 63–84% with the old slow opening. Covered by a first-frame test.
- **Growth content mix** per account (`formatStrategy = GROWTH_MIX`): 60% Reels, 30% feed, 10% stories, chosen automatically from the last 14 days. Opt-in; existing accounts keep FIXED.
- Default Reel length for new accounts is 10 s (measured average watch time: 3–9 s).
- Caption rules: natural Bahraini Arabic, hook under 125 characters, short body, send-to-a-friend and DM-keyword CTAs, 3–5 hashtags. The Instagram hashtag cap in the publisher is now 5.
- The analytics parser understands the real Metricool fields (`timestamp`, `reelsSkipRate`, `retention`, `durationSeconds`, `follows`, `permalink`). Previously `timestamp` was not read, so time-based matching would have failed.
- Reports show the Reel skip rate and retention, and warn when skips exceed 60% or a period has zero comments and shares.
- 135 tests passing.

## 8.0.0 — 2026-11-11 (V8 Enterprise upgrade)

An incremental upgrade of the existing system. Every V7 feature is kept, the database migration only adds things, and all 129 automated tests pass.

### Publishing reliability (critical fixes first)
- **UNKNOWN submissions are no longer re-sent automatically.** After a search miss, the job stays `UNKNOWN`, an operator is notified, and the decision is theirs:
  - "بحث ثم إعادة الإرسال" (search, then resend) runs a fresh Metricool lookup first.
  - "إلغاء" (cancel) closes the job without sending.
  - The old behaviour is available only through the `publishing.autoResubmitAfterAbsence` setting (off by default).
- **Approval binding:** the SHA-256 of the exact approved media is stored on the approval record. Before every submission the publisher re-hashes the bytes on disk. A file modified or replaced after rendering or approval is refused.
- **Per-account emergency pause** (`SocialAccount.paused`):
  - stops automatic generation (scheduler and campaigns);
  - refuses new publication jobs;
  - holds already-queued submissions without sending them.
  - Controls are in the dashboard, the API (`POST /api/accounts/:id/pause`) and the CLI.
- **Stuck-job detection** now runs every 5 minutes, not only at worker restart. An expired submission lease becomes `UNKNOWN`, which leads to reconciliation, never a blind resend.
- **Worker liveness:** the worker writes a heartbeat to Redis every minute.
- **Structured JSON logs** with correlation IDs (the publication idempotency key) and automatic secret redaction.
- API: a missing record now returns 404 instead of 500.

### Scheduling
- The default publishing interval is now **every 7 hours** per account (`publishIntervalMinutes` 420; `maxDailyAds` 4).
- The migration moves accounts still on the untouched old default (60 min / 24 per day) to the new default. Customised accounts are kept.
- Per-account settings still override the global defaults.

### Quality control and approval
- Explicit QC verdicts are shown on the ad page and in the approval queue:
  - `PASS`
  - `NEEDS_REVIEW`
  - `NEEDS_ASSET`
  - `REJECTED`
- **Request changes:** closes the current version with the note and generates a new revision with the same account, product, format, language and creative direction, plus the note.
- Revision history is shown on the ad page.

### Growth analytics (new)
- Read-only import of Metricool per-post analytics, twice a day plus a manual button. Metrics are matched to provider-verified publications by public URL, or by a unique same-type post within ±20 minutes. Ambiguous matches are skipped, missing metrics stay empty, and manual entries are never overwritten.
- Pattern engine with Welch's t-test across format, posting hour, design style, content type, occasion, category, language and template:
  - `CONFIRMED` only when p < 0.05 and there are at least 5 posts on each side;
  - otherwise `TREND` or `INSUFFICIENT`, with a proposed A/B test and an estimate of the posts needed per variant.
- Weekly and monthly reports per account or for all accounts: the **التقارير والتجارب** page and `GET /api/reports`.

### Operations
- **تشخيص النظام** (system diagnostics) page and `GET /api/diagnostics`. Covers the database, Redis, worker heartbeat, kill switch, mode, OpenAI and Metricool configuration (never secret values), the logo, FFmpeg, accounts and connections, stuck/unknown/overdue/failed jobs, and pending approvals.
- The top bar no longer shows "OpenAI مباشر" (live) when no key is configured.

### Claude Code
- 8 skills in `.claude/skills/`, each backed by the real operator CLI (`scripts/ig/cli.ts`, `scripts/ig/run.sh`):
  - `/ig-command`
  - `/ig-health`
  - `/ig-autodesign`
  - `/ig-video-engine`
  - `/ig-publish-safe`
  - `/ig-recover`
  - `/ig-report`
  - `/ig-experiments`
- A least-privilege `ig-operator` agent (Bash and Read only, CLI only).
- State-changing CLI commands require `--confirm`. Nothing in the CLI submits a post directly.

### Database
- Migration `20261111090000_v8_reliability` adds:
  - `social_accounts.paused`, `pausedReason` and `pausedAt`;
  - new defaults for the interval and daily limit;
  - `approval_requests.mediaSha256`;
  - `publication_results.metricsFetchedAt` and `metricsSource`.

## 7.x — earlier (summary)
- Metricool audit: real best posting hours, story captions, media URLs ending in a file extension, per-network caption limits, alt text, optional first-comment hashtags, hourly connection health check.
- One-click Metricool linking; optional approval for full-AI designs; full-AI poster mode; gold poster template; publishing channels, design type and style, pro reels, reel duration and audio; recurring campaigns; fix for the OpenAI temperature error.
