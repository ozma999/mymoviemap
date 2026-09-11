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

import { getStore, K_POSTERS, K_FAME } from './_store.js';

export const VER = '2026-09-11-a';   // 배포 확인용 (/api/tmdb?diag=1)

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

/* ── 포스터 찾기 ───────────────────────────────────────────────
   「사도」처럼 짧고 흔한 한글 제목은 검색 첫 줄이 엉뚱한 영화일 때가 많습니다.
   그래서 (1) 원제로도 찾아보고 (2) 찾은 결과가 정말 그 영화인지 점수로 검증한 뒤
   확신이 없으면 차라리 포스터를 안 답니다. 틀린 포스터가 빈 자리보다 나쁩니다.
   ────────────────────────────────────────────────────────────── */
function score(m, t, o, y) {
  const cand = [m.title, m.original_title].filter(Boolean).map(norm);
  const want = [t, o].filter(Boolean).map(norm);
  let s = 0;

  if (want.some((w) => cand.includes(w))) s += 100;                       // 제목이 정확히 같다
  else if (want.some((w) => cand.some((c) => c.includes(w) || w.includes(c)))) s += 35;

  const my = +(m.release_date || '').slice(0, 4) || 0;
  if (y && my) {
    const gap = Math.abs(my - +y);
    if (gap === 0) s += 60; else if (gap <= 1) s += 40; else if (gap <= 3) s += 5; else s -= 70;
  }
  s += Math.min(12, Math.log10((m.vote_count || 0) + 1) * 4);            // 동점일 때만 갈리도록 작게
  return s;
}

/* TMDB 번호를 아는 작품은 검색할 필요가 없습니다. 그 번호가 곧 정답입니다. */
async function movieById(id) {
  try { return await tmdb('/movie/' + encodeURIComponent(id), { append_to_response: 'credits' }); }
  catch { return null; }
}

/* 그 작품에 대해 알아 둘 것 — 표 수·제작국·연도·감독.
   연도가 있어야 연도표에 점을 찍을 수 있습니다. 예전에 낸 카드에는 연도가 없어서
   이 값이 없으면 그 작품이 연도표에서 통째로 빠집니다. */
const fameOf = (m) => (m ? {
  v: m.vote_count || 0,
  c: (m.origin_country || [])[0] || (m.production_countries?.[0]?.iso_3166_1) || '',
  y: +(m.release_date || '').slice(0, 4) || null,
  d: (((m.credits && m.credits.crew) || [])
       .filter((c) => c.job === 'Director').map((c) => c.name).join(', ')) || '',
} : null);
/* 예전 형식({v,c}만 있는 것)은 연도가 없으니 다시 받아 옵니다. */
const fameFull = (f) => f === null || (f && Object.prototype.hasOwnProperty.call(f, 'y'));

async function findMovie(t, o, y) {
  const queries = [];
  if (o && norm(o) !== norm(t)) queries.push(o);   // 원제가 훨씬 잘 걸립니다
  queries.push(t);

  const seen = new Map();
  for (const q of queries) {
    for (const params of (y ? [{ primary_release_year: y }, {}] : [{}])) {
      let d;
      try { d = await tmdb('/search/movie', { query: q, include_adult: false, ...params }); }
      catch { continue; }
      for (const m of (d.results || []).slice(0, 10)) if (!seen.has(m.id)) seen.set(m.id, m);
      if ([...seen.values()].some((m) => score(m, t, o, y) >= 140)) break;   // 확실한 게 나왔으면 그만
    }
  }
  if (!seen.size) return null;

  const best = [...seen.values()]
    .map((m) => ({ m, s: score(m, t, o, y) }))
    .sort((a, b) => b.s - a.s)[0];

  // 제목이 맞거나(100+) 연도까지 맞아야 인정합니다. 애매하면 아무것도 안 답니다.
  return best.s < 100 ? null : best.m;
}

/* 포스터 캐시 — 한 번 찾은 포스터는 저장해 두고 다시 안 물어봅니다. */
async function cacheGet() {
  const s = getStore();
  if (!s) return {};
  try { return (await s.get(K_POSTERS, {})) || {}; } catch { return {}; }
}
// keepExisting=true 면 이미 있는 제목은 건드리지 않습니다.
// 검색 결과가 사전에 있는 같은 제목의 '다른 영화'를 덮어쓰는 사고를 막습니다.
async function cacheMerge(add, keepExisting) {
  const s = getStore();
  if (!s || !Object.keys(add).length) return;
  try {
    const cur = (await s.get(K_POSTERS, {})) || {};
    const next = keepExisting ? { ...add, ...cur } : { ...cur, ...add };
    await s.set(K_POSTERS, next);
  } catch { /* 캐시는 실패해도 무시 */ }
}
/* 표 수·제작국 캐시 — 포스터와 같은 방식으로 한 번만 찾아 둡니다. */
async function fameGet() {
  const s = getStore();
  if (!s) return {};
  try { return (await s.get(K_FAME, {})) || {}; } catch { return {}; }
}
async function fameMerge(add) {
  const s = getStore();
  if (!s || !Object.keys(add).length) return;
  try {
    const cur = (await s.get(K_FAME, {})) || {};
    await s.set(K_FAME, { ...cur, ...add });
  } catch { /* 캐시는 실패해도 무시 */ }
}

// 잘못 박힌 포스터를 지웁니다. 지우면 다음 방문 때 새 방식으로 다시 찾습니다.
async function cacheDrop(titles) {
  const s = getStore();
  if (!s) return 0;
  try {
    const cur = (await s.get(K_POSTERS, {})) || {};
    if (!titles) { await s.set(K_POSTERS, {}); return Object.keys(cur).length; }
    let n = 0;
    titles.forEach((t) => { if (cur[t] !== undefined) { delete cur[t]; n++; } });
    await s.set(K_POSTERS, cur);
    return n;
  } catch { return 0; }
}

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query?.diag === '1') {
    return res.status(200).json({
      버전: VER,
      기능_표수_수집: true,              // 이 값이 안 보이면 예전 파일이 올라가 있는 것입니다
      열쇠_꽂힘: !!KEY,
      안내: KEY
        ? 'TMDB 검색·포스터가 켜져 있습니다.'
        : 'Vercel → Settings → Environment Variables 에 TMDB_KEY 를 추가하고 Redeploy 하세요. 없어도 내장 사전 338편으로는 동작합니다.',
    });
  }

  /* ── 잘못 박힌 포스터 지우기 ──
     /api/tmdb?repair=1        → 저장된 포스터를 전부 비웁니다 (다음 방문 때 다시 찾습니다)
     /api/tmdb?repair=사도,올드보이 → 그 작품만 비웁니다
     지워도 카드·메모·기록은 그대로입니다. 포스터는 언제든 다시 만들 수 있는 값입니다. */
  if (req.method === 'GET' && req.query?.repair) {
    const v = String(req.query.repair);
    const only = (v === '1' || v === 'all') ? null
      : v.split(',').map((x) => x.trim()).filter(Boolean);
    const n = await cacheDrop(only);
    const s0 = getStore();
    if (s0 && !only) { try { await s0.set(K_FAME, {}); } catch {} }
    return res.status(200).json({
      ok: true, 지운_포스터_수: n,
      대상: only ? only : '전체',
      안내: '이제 사이트를 새로고침하면 포스터를 처음부터 다시 찾습니다. 카드와 메모는 그대로입니다.',
    });
  }

  if (!KEY) return res.status(200).json(NOKEY);

  try {
    /* ── 여러 제목의 포스터를 한 번에 (사전 항목용) ── */
    if (req.method === 'POST') {
      const titles = (req.body?.titles || []).slice(0, 12);
      if (!titles.length) return res.status(200).json({ ok: true, posters: {} });

      const force = !!req.body?.force;
      const [pCache, fCache] = await Promise.all([
        force ? {} : cacheGet(),
        force ? {} : fameGet(),
      ]);
      const out = {}, fresh = {};          // 포스터
      const fOut = {}, fFresh = {};        // 표 수·제작국

      for (const it of titles) {
        const t = String(it.t || '').trim();
        if (!t) continue;
        const hit = pCache[t], fHit = fCache[t];
        const needPoster = !hit && !(hit === '' && !it.id);
        const needFame = fHit === undefined || !fameFull(fHit);
        if (!needPoster && !needFame) { out[t] = hit; fOut[t] = fHit; continue; }

        try {
          // 한 번 찾은 결과에서 포스터와 표 수를 함께 꺼냅니다. 두 번 물을 이유가 없습니다.
          let m = it.id ? await movieById(it.id) : null;
          if (!m || (!m.poster_path && !m.vote_count)) m = await findMovie(t, it.o, it.y) || m;

          const url = m ? IMG(m.poster_path) : '';
          out[t] = hit || url;
          if (url || hit === undefined) fresh[t] = out[t];

          const f = fameOf(m);
          if (f) { fOut[t] = f; fFresh[t] = f; }
          else { fOut[t] = fHit ?? null; if (fHit === undefined) fFresh[t] = null; }
        } catch { out[t] = hit || ''; fOut[t] = fHit ?? null; }
      }
      await Promise.all([cacheMerge(fresh), fameMerge(fFresh)]);
      return res.status(200).json({ ok: true, posters: out, fame: fOut });
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
        votes: d.vote_count || 0,
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

    // 검색으로 알아낸 포스터도 캐시에 넣어 둔다.
    // 단, 이미 있는 제목은 덮어쓰지 않습니다 — 같은 제목의 다른 영화가
    // 사전 작품의 포스터를 밀어내는 사고를 막습니다.
    const fresh = {};
    results.forEach((r) => { if (r.poster) fresh[r.title] = r.poster; });
    cacheMerge(fresh, true);

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
}
