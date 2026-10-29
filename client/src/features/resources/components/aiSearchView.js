// Explore's AI search text (AiResults.jsx, ExplorePage.jsx), in a module of its own so the
// components' files export components only (fast refresh).
import { filterAiPicks } from '../api';

/** "1 pick from Gemini", "3 picks from Gemini". */
export const pickCount = (n) => `${n} ${n === 1 ? 'pick' : 'picks'} from Gemini`;

/** The fallback reasons after which asking again today can't help (the retry button is hidden). */
export const DAILY_REASONS = new Set(['USER_DAILY', 'POOL_DAILY', 'GLOBAL_DAILY']);

/**
 * What the page's one live region says about the AI search: "Asking Gemini…", then the picks
 * (and how many the filters hide). Empty before the question is confirmed and on an error (the
 * error box is an alert of its own).
 */
export function aiAnnouncement(search, filters, confirmed) {
  if (!confirmed) return '';
  if (search.isFetching) return 'Asking Gemini…';
  if (!search.isSuccess) return '';
  const all = Array.isArray(search.data?.data?.items) ? search.data.data.items : [];
  const picks = filterAiPicks(all, filters);
  const hidden = all.length - picks.length;
  return `${pickCount(picks.length)}${hidden ? `, ${hidden} hidden by your filters` : ''}.`;
}
