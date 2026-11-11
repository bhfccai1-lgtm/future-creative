/** Normalised competitor data (from Metricool's Instagram competitor analytics or a Metricool CSV export). */
export interface CompetitorSummary { handle: string; name?: string; followers?: number; posts?: number; reels?: number; likes?: number; comments?: number; engagement?: number }
export interface CompetitorPost { handle: string; id?: string; type: 'post' | 'reel'; caption: string; publishedAt?: Date; likes?: number; comments?: number; interactions?: number; engagement?: number; url?: string }
export interface OwnPost { type: 'post' | 'reel' | 'story' | 'carousel'; caption: string; publishedAt: Date; interactions?: number }
