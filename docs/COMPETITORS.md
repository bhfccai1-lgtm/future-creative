# Competitor analysis

**Data sources.** Instagram is never scraped directly; that is against its terms. There are two sources:
1. **Metricool** (Competitors): the competitors you add in Metricool for each brand. They are pulled automatically every day at 06:20, or on demand with «تحديث من Metricool» (refresh from Metricool).
   - The REST paths `/v2/analytics/competitors/instagram{,/posts,/reels}` have not yet been called against a live account. A failure is reported per brand, and nothing is invented.
2. **CSV export from Metricool**, uploaded on the page:
   - It contains the competitors table and/or their posts. Both files are merged into one snapshot when uploaded on the same day.
   - Column names are read flexibly, in English or Arabic.

**What the analysis shows** (30-day window):
- **Benchmark** (us vs each competitor):
  - followers, and growth versus a snapshot at least 6 days older;
  - posts per week, Reel share;
  - average interactions per post, and engagement rate (interactions ÷ followers).
- **Formats:** Reel interactions vs feed-post interactions, with the sample size.
- **Best hour and best day:** each needs at least 3 posts, so there is no conclusion from a single post.
- **Content:**
  - the top 10 posts;
  - themes over-represented in the top-performing quarter, and the most used hashtags;
  - **gaps:** themes that work for them and that we don't use.
- **Competitive recommendations:** only when data supports them. Topics: posting cadence, formats, timing, gaps, fastest-growing competitor, engagement gap. A warning is shown when the sample is small.
- **Ideas inspired by the market:** 3 *original* ideas built from the winning themes and formats, with an explicit instruction not to copy wording, designs or offers. One click opens the create page with the idea filled in.

**Elsewhere:**
- **Advisor:** "add competitors" if there is no data, and "data is stale" after 14 days.
- **n8n:** `GET /api/integrations/n8n/competitors?brand=<blogId>`.

**Setup:** in Metricool → choose the brand → **Competitors** → add 5–10 local Instagram accounts (print shops, custom-gift stores, sticker printers). Then press «تحديث من Metricool» on the تحليل المنافسين (competitor analysis) page, or upload a CSV export.
