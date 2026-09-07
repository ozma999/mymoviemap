// 양자택일 — 두 편을 놓고 하나 고르기.
//
//   GET  /api/duel   → 작품별 승패 + 대결별 표
//   POST /api/duel   → { by, win, lose }
//
// 부담이 가장 낮은 참여 장치입니다. 카드를 내지 않은 사람도 클릭 한 번이면 됩니다.
// 집계는 작품별 칸에 따로 쌓아서, 여러 명이 동시에 눌러도 서로 지우지 않습니다.

import { getStore, cleanName, K_DUEL } from './_store.js';

const NEED_STORAGE = { error: '저장소가 연결되지 않았습니다. (진단: /api/club?diag=1)' };
const SEP = '@@';
const pairKey = (a, b) => 'p|' + [a, b].sort().join(SEP);

async function readAll(store) {
  const h = await store.hgetall(K_DUEL);
  const films = {}, pairs = {};
  for (const f in h) {
    if (f.startsWith('f|')) films[f.slice(2)] = h[f];
    else if (f.startsWith('p|')) pairs[f.slice(2)] = h[f];
  }
  return { films, pairs };
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
    const win  = String(b.win  || '').trim().slice(0, 120);
    const lose = String(b.lose || '').trim().slice(0, 120);
    if (!win || !lose || win === lose) {
      return res.status(400).json({ error: '두 편이 필요합니다.' });
    }

    const all = await store.hgetall(K_DUEL);

    const w = all['f|' + win]  || { win: 0, loss: 0 };
    const l = all['f|' + lose] || { win: 0, loss: 0 };
    w.win  = (w.win  || 0) + 1;
    l.loss = (l.loss || 0) + 1;
    await store.hset(K_DUEL, 'f|' + win,  w);
    await store.hset(K_DUEL, 'f|' + lose, l);

    const pk = pairKey(win, lose);
    const p = all[pk] || {};
    p[win] = (p[win] || 0) + 1;
    if (p[lose] === undefined) p[lose] = 0;
    await store.hset(K_DUEL, pk, p);

    return res.status(200).json({
      ok: true,
      pairKey: pk.slice(2),
      by: cleanName(b.by),
      ...(await readAll(store)),
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
