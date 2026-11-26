import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { searchYouTube } from '../providers';
import { logger } from '../logger';

const router = Router();
router.use(requireAuth);

const searchSchema = z.object({
  q: z.string().trim().min(1).max(160),
  limit: z.coerce.number().int().min(1).max(12).default(6),
});

router.get('/search', async (req, res) => {
  try {
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a search query.' });
      return;
    }
    const results = await searchYouTube(parsed.data.q, parsed.data.limit);
    res.json({ results });
  } catch (err) {
    logger.error('music_search_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'YouTube search is temporarily unavailable.' });
  }
});

export default router;
