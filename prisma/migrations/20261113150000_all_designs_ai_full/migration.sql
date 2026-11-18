-- Owner request (2026-11-13): every design is a full AI poster (all formats). «تلقائي» now means the full AI poster
-- everywhere (except Veo reels), so automatic designs switch from the layered template back to «تلقائي».
UPDATE "system_settings"
SET "value" = jsonb_set("value"::jsonb, '{ai,autoRenderMode}', '"auto"', true)
WHERE "key" = 'system' AND "value"::jsonb ? 'ai' AND COALESCE("value"::jsonb #>> '{ai,autoRenderMode}', 'auto') = 'layered';
