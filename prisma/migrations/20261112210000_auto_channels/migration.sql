-- Multi-channel: networks (linked on the Metricool brand) added automatically to every compatible post, and the Pinterest board
ALTER TABLE "social_accounts" ADD COLUMN "autoChannels" "SocialPlatform"[] DEFAULT ARRAY[]::"SocialPlatform"[];
ALTER TABLE "social_accounts" ADD COLUMN "pinterestBoard" TEXT;
