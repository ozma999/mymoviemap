// 블라인드 — 이 열 편은 누구의 카드인가.
//
//   GET  /api/blind   → 최고 기록 + 카드별 난이도
//   POST /api/blind   → { by, score, total, results:[{owner, correct}] }
//
// 기록은 사람마다 한 칸씩 따로 씁니다. 카드 데이터는 건드리지 않습니다.

import { getStore, cleanName, K_BLIND } from './_store.js';

const NEED_STORAGE = { error: '저장소가 연결되지 않았습니다. (진단: /api/club?diag=1)' };

async function readAll(store) {
  const h = await store.hgetall(K_BLIND);
  const scores = {}, cards = {};
  for (const f in h) {
    if (f.startsWith('s|')) scores[f.slice(2)] = h[f];
    else if (f.startsWith('c|')) cards[f.slice(2)] = h[f];
  }
  return { scores, cards };
}

export default async function handler(req, res) {
  const store = getStore();
  if (!store) return res.status(503).json(NEED_STORAGE);

  try {
    if (req.method === 'GET') return res.status(200).json(await readAll(store));

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
    }

    const b = req.body || {};
    const by = cleanName(b.by);
    const score = Math.max(0, Math.min(99, +b.score || 0));
    const total = Math.max(1, Math.min(99, +b.total || 10));
    const results = Array.isArray(b.results) ? b.results.slice(0, 40) : [];

    // 카드별 난이도는 익명으로도 쌓습니다.
    for (const r of results) {
      const owner = cleanName(r && r.owner);
      if (!owner) continue;
      const cur = (await store.hgetall(K_BLIND))['c|' + owner] || { right: 0, wrong: 0 };
      if (r.correct) cur.right = (cur.right || 0) + 1; else cur.wrong = (cur.wrong || 0) + 1;
      await store.hset(K_BLIND, 'c|' + owner, cur);
    }

    // 최고 기록은 이름을 밝힌 사람만 남깁니다.
    if (by) {
      const all = await store.hgetall(K_BLIND);
      const cur = all['s|' + by] || { best: 0, plays: 0 };
      cur.plays = (cur.plays || 0) + 1;
      cur.total = total;
      if (score > (cur.best || 0)) cur.best = score;
      cur.last = score;
      await store.hset(K_BLIND, 's|' + by, cur);
    }

    return res.status(200).json({ ok: true, ...(await readAll(store)) });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
