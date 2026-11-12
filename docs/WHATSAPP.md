# WhatsApp — catalogue sync and status pack

## 1. WhatsApp catalogue (official, Meta Catalog Batch API)
1. business.facebook.com → **Commerce Manager** → create a catalogue (type: E-commerce / Products). Copy its **Catalog ID**.
2. WhatsApp Manager → your number → **Catalog** → connect that catalogue (and enable "Show catalogue").
3. Business Settings → **System users** → add (Admin) → **Assign assets**: the catalogue (Manage catalogue) → **Generate token** with `catalog_management` (and `business_management`), expiry *Never*.
4. Dashboard → Integrations → **WhatsApp**: paste the Catalog ID and the token (stored encrypted) → Save → **Test** → **Sync now**.

Only products with a **starting price** (Products page or CSV column `price`) **and an approved design** are sent — Meta requires both. Inactive / out-of-scope products are removed. Daily automatic sync at 04:10 (Bahrain). Each item links to the public page `/p/<slug>` with WhatsApp buttons for each branch.

## 2. Status pack (no official API for WhatsApp Status)
WhatsApp offers no official API for posting Status; unofficial automation risks banning the number, so the system never posts to Status.
Instead, one verified post per hour (09:00–21:00, up to the daily cap, reels first) is sent to the owner's Telegram with ready-to-copy text. Requires the Telegram bot + chat id from the n8n settings.
