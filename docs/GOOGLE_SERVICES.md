# Google services: Business Profile, YouTube Shorts, Drive and Sheets

| Service | How | What the system sends | Status |
|---|---|---|---|
| **Google Business Profile** (Google Maps / Search) | Metricool network `gmb` | **Image design →** `gmbData.type = "publication"`: a text update (≤ 1500 characters) with the cover image. **Reel →** `"photo"`: the video goes to the profile gallery, with no text (Google's rule). | ✅ implemented and tested (mocked provider) · ❌ not yet live |
| **YouTube Shorts** | Metricool network `youtube` | `type = "short"`, title ≤ 100 characters, the caption as description, tags taken from the hashtags, `madeForKids = false`, `isAiGeneratedContent = true` | ✅ / ❌ live |
| **Google Drive** (archive) | n8n template `06` | Every **verified** publication: the exact published files (cover + slides, or the MP4) are uploaded to your folder | ✅ code tested in real n8n 2.35.7 (download and naming) · ❌ Drive upload needs your Google account |
| **Google Sheets** (post log) | n8n template `06` (+ `04` for ideas) | One row per post: date, account, format, headline, Instagram link, Drive link | same as above |

## Automatic Google Business Profile
- In the account settings, turn on **«نشر تلقائي على ملف Google التجاري»** (automatic posting to Google Business) and choose how many updates per week (1–2 recommended).
- Automatic designs then add the Google channel by themselves, but only when all of these hold:
  - Google Business is linked to that brand in Metricool;
  - the format suits Google: a feed or square image becomes an update, a reel goes to the gallery. Stories and carousels are skipped;
  - the weekly limit hasn't been reached.
- **System diagnostics** shows a recommendation when no brand is linked to Google Business.

## Why the Google Business post is separate
- One Metricool post carries a single text for all its networks.
- Instagram posts must show both branch phone numbers, but **Google rejects Business Profile posts that contain phone numbers** (customers use the profile's Call button). Hashtags have no effect on Google either.
- So when a design targets Instagram + Google, the system creates **two publication jobs**:
  - the **primary** job (Instagram, with the phones);
  - a **satellite** job (Google): no phones, no hashtags, and a local line naming both branches for local search (e.g. «📍 مطبعة إبداع المستقبل — فرع سار وفرع سلماباد، البحرين»).
- A failed Google post **never** marks the Instagram design as failed. Both jobs appear in the posts log ("نسخة مرافقة" = companion copy).

## Setup
1. **In Metricool:** connect your Google Business Profile, and/or your YouTube channel, to the brand. The hourly connection check detects it automatically.
2. **In the system:**
   - Choose the channel **«ملف Google التجاري (خرائط وبحث Google)»** and/or **«يوتيوب شورتس»** on the create page or in a campaign.
   - YouTube requires the Reel format.
3. **Drive and Sheets (n8n):**
   - Create a folder in Google Drive. Put its id (the part after `/folders/` in the link) in `.env` as `GDRIVE_FOLDER_ID`.
   - Create a Google Sheet with a tab named `published` and the columns `date, account, format, headline, instagram, drive, adId`.
   - Import `06-archive-to-google-drive-sheets.json`, then add the **Google Drive** and **Google Sheets** credentials in n8n and choose the sheet.
   - **Publish workflow 06.** In n8n 2.x a sub-workflow must be published before another workflow can call it; this was found in the live test.
   - Workflow 01 calls 06 automatically for every `publication.published` event.

## Tips for Google Business Profile (local SEO)
- Post 1–2 updates per week. Recent activity helps a profile in Maps results.
- Use clear product photos (cover images). Google crops images to roughly 4:3, so feed or carousel covers work better than 9:16 stories.
- Reels go to the profile's **gallery**, which gives customers more photos and videos on your profile.
- Keep the phones and address in the profile itself (Google shows them with a Call button).
