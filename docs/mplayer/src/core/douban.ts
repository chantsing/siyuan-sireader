// =============================================================================
// Douban API Service (via Siyuan Forward Proxy)
// =============================================================================
// Provides functions to fetch accurate movie details from the Douban API.

const DOUBAN_MOBILE_API_BASE = 'https://m.douban.com/rexxar/api/v2';
const PROXY_URL = '/api/network/forwardProxy';

/**
 * Fetches data from the Douban Mobile API using Siyuan's forward proxy.
 * @param path The API path (e.g., '/search/subjects').
 * @param params URL query parameters.
 * @returns The parsed JSON response.
 */
async function doubanFetch(path: string, params: Record<string, any> = {}) {
  const targetUrl = new URL(`${DOUBAN_MOBILE_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => targetUrl.searchParams.append(key, String(value)));

  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: targetUrl.toString(),
        method: 'GET',
        timeout: 7000,
        headers: [{ 'Referer': 'https://m.douban.com/' }]
      })
    }).then(r => r.json());

    if (res.code !== 0) throw new Error(`Proxy request failed: ${res.msg}`);

    return JSON.parse(res.data.body);
  } catch (error) {
    console.error('Douban Mobile API fetch error:', error);
    return null;
  }
}

/**
 * Searches for a movie by its title and returns the best match.
 * @param query The movie title to search for.
 * @returns The first movie object from the search results, or null if not found.
 */
export async function searchMovie(query: string): Promise<any | null> {
  const key = `${query || ''}`.trim();
  if (!key) return null;
  const data = await doubanFetch('/search/subjects', { q: query, type: 'movie', count: 1 });
  const movieItem = data?.subjects?.items?.[0];
  if (!movieItem) return null;
  // The ID is in `target_id`, the rest of the info is in `target`
  return { id: movieItem.target_id, ...movieItem.target };
}

/**
 * Fetches detailed information for a specific movie by its Douban ID.
 * @param id The Douban movie ID.
 * @returns A detailed movie object, or null on failure.
 */
export async function getMovieDetail(id: string): Promise<any | null> {
  if (!id) return null;
  return await doubanFetch(`/movie/${id}`);
}

const sanitizeTvTitle = (title = '') =>
  `${title || ''}`
    .replace(/[（(]\s*第?\s*\d+\s*[集话季部篇期]\s*[）)]/g, '')
    .replace(/第\s*\d+\s*[集话季部篇期]/g, '')
    .replace(/\s*[-_]\s*第?\s*\d+\s*[集话季部篇期].*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export async function enrichTvboxDetailWithDouban(title: string, detail: any = {}) {
  const query = sanitizeTvTitle(title || detail?.title || detail?.vod_name || '');
  if (!query) return detail || {};

  const match = await searchMovie(query);
  if (!match?.id) return detail || {};

  const doubanDetail = await getMovieDetail(match.id);
  if (!doubanDetail) return detail || {};

  return {
    ...detail,
    title: doubanDetail.title || detail?.title,
    original_title: doubanDetail.original_title || detail?.original_title || '',
    pic: doubanDetail.pic?.large || doubanDetail.pic?.normal || detail?.pic || '',
    genres: doubanDetail.genres?.length ? doubanDetail.genres : detail?.genres,
    rating: doubanDetail.rating || detail?.rating,
    score: doubanDetail.rating?.value || detail?.score || '',
    directors: doubanDetail.directors?.length ? doubanDetail.directors : detail?.directors,
    casts: doubanDetail.actors?.length ? doubanDetail.actors : detail?.casts,
    year: doubanDetail.year || detail?.year || '',
    countries: doubanDetail.countries?.length ? doubanDetail.countries : detail?.countries,
    summary: doubanDetail.intro || detail?.summary || detail?.content || '',
    aka: doubanDetail.aka?.length ? doubanDetail.aka : detail?.aka,
    durations: doubanDetail.durations?.length ? doubanDetail.durations : detail?.durations,
    trailers: doubanDetail.trailers?.length ? doubanDetail.trailers : detail?.trailers,
    pubdate: doubanDetail.pubdate || detail?.pubdate || '',
    languages: doubanDetail.languages?.length ? doubanDetail.languages : detail?.languages,
    episodes_count: doubanDetail.episodes_count || detail?.episodes_count || 0,
  };
}

