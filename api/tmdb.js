// TMDB(전 세계 영화 데이터베이스) 연결 창구.
//
//   GET  /api/tmdb?q=기생충      → 제목 검색 (포스터 포함)
//   GET  /api/tmdb?id=496243     → 그 영화의 감독·러닝타임·국가
//   POST /api/tmdb  {titles:[{t,y}]} → 여러 편의 포스터를 한 번에 (사전 항목용)
//   GET  /api/tmdb?diag=1        → 열쇠(API 키)가 꽂혀 있는지 확인
//
// ── 왜 서버를 거치나 ──────────────────────────────────────────
// TMDB는 '열쇠(API 키)'가 있어야 답을 줍니다. 그 열쇠를 index.html에 적으면
// 사이트에 접속한 누구나 열쇠를 훔쳐볼 수 있습니다. 그래서 열쇠는 Vercel에만 넣어두고,
// 브라우저는 이 파일에게 물어보고 이 파일만 TMDB에게 물어봅니다.
//
// 열쇠가 없어도 사이트는 그대로 돌아갑니다. 내장 사전 338편으로만 검색되고
// 포스터가 안 붙을 뿐입니다.

import { getStore, K_POSTERS } from './_store.js';

const KEY = process.env.TMDB_KEY || process.env.TMDB_API_KEY || '';
const IMG = (p, size = 'w185') => (p ? `https://image.tmdb.org/t/p/${size}${p}` : '');
const NOKEY = { ok: false, reason: 'no_key' };

const norm = (s) => String(s || '').toLowerCase().replace(/\s|·|:|,|\.|!|\?|'|’|-/g, '');

async function tmdb(path, params) {
  const u = new URL('https://api.themoviedb.org/3' + path);
  u.searchParams.set('api_key', KEY);
  u.searchParams.set('language', 'ko-KR');
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v));
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

const shape = (m) => ({
  tmdb: m.id,
  title: m.title || m.original_title || '',
  orig: m.original_title || '',
  year: (m.release_date || '').slice(0, 4) || '',
  poster: IMG(m.poster_path),
  pop: m.vote_count || 0,
});

/* 포스터 캐시 — 한 번 찾은 포스터는 저장해 두고 다시 안 물어봅니다. */
async function cacheGet() {
  const s = getStore();
  if (!s) return {};
  try { return (await s.get(K_POSTERS, {})) || {}; } catch { return {}; }
}
async function cacheMerge(add) {
  const s = getStore();
  if (!s || !Object.keys(add).length) return;
  try {
    const cur = (await s.get(K_POSTERS, {})) || {};
    await s.set(K_POSTERS, { ...cur, ...add });
  } catch { /* 캐시는 실패해도 무시 */ }
}

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query?.diag === '1') {
    return res.status(200).json({
      열쇠_꽂힘: !!KEY,
      안내: KEY
        ? 'TMDB 검색·포스터가 켜져 있습니다.'
        : 'Vercel → Settings → Environment Variables 에 TMDB_KEY 를 추가하고 Redeploy 하세요. 없어도 내장 사전 338편으로는 동작합니다.',
    });
  }

  if (!KEY) return res.status(200).json(NOKEY);

  try {
    /* ── 여러 제목의 포스터를 한 번에 (사전 항목용) ── */
    if (req.method === 'POST') {
      const titles = (req.body?.titles || []).slice(0, 12);
      if (!titles.length) return res.status(200).json({ ok: true, posters: {} });

      const cache = await cacheGet();
      const out = {}, fresh = {};

      for (const it of titles) {
        const t = String(it.t || '').trim();
        if (!t) continue;
        if (cache[t] !== undefined) { out[t] = cache[t]; continue; }
        try {
          const d = await tmdb('/search/movie', {
            query: t, include_adult: false,
            ...(it.y ? { primary_release_year: it.y } : {}),
          });
          let hit = (d.results || [])[0];
          // 연도를 걸고 못 찾으면 연도 없이 한 번 더
          if (!hit && it.y) {
            const d2 = await tmdb('/search/movie', { query: t, include_adult: false });
            hit = (d2.results || []).find(
              (m) => Math.abs(+(m.release_date || '0').slice(0, 4) - +it.y) <= 1
            ) || (d2.results || [])[0];
          }
          const url = hit ? IMG(hit.poster_path) : '';
          out[t] = url; fresh[t] = url;                 // 못 찾은 것도 '' 로 캐시 (재조회 방지)
        } catch { out[t] = ''; }
      }
      await cacheMerge(fresh);
      return res.status(200).json({ ok: true, posters: out });
    }

    /* ── 상세: 감독·러닝타임·국가 ── */
    if (req.query?.id) {
      const d = await tmdb('/movie/' + encodeURIComponent(req.query.id), {
        append_to_response: 'credits',
      });
      const dirs = ((d.credits && d.credits.crew) || [])
        .filter((c) => c.job === 'Director').map((c) => c.name);
      return res.status(200).json({
        ok: true,
        director: dirs.join(', '),
        year: (d.release_date || '').slice(0, 4),
        runtime: d.runtime || null,
        country: (d.origin_country || [])[0] || (d.production_countries?.[0]?.iso_3166_1) || '',
        genres: (d.genres || []).map((g) => g.name),
      });
    }

    /* ── 검색 ── */
    const q = String(req.query?.q || '').trim();
    if (!q) return res.status(400).json({ ok: false, error: '검색어가 없습니다.' });

    const d = await tmdb('/search/movie', { query: q, include_adult: false });
    const seen = new Set();
    const results = (d.results || [])
      .filter((m) => {
        const k = norm(m.title) + (m.release_date || '').slice(0, 4);
        if (seen.has(k)) return false;
        seen.add(k); return true;
      })
      .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
      .slice(0, 14)
      .map(shape);

    // 검색으로 알아낸 포스터도 캐시에 넣어 둔다
    const fresh = {};
    results.forEach((r) => { if (r.poster) fresh[r.title] = r.poster; });
    cacheMerge(fresh);

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
}
