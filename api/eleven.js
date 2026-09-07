// 열한 번째 자리 — 남의 카드에 한 편을 권하고, 주인이 채택하면 열한 번째로 들어갑니다.
//
//   GET  /api/eleven   → 들어온 추천 + 채택된 열한 번째
//   POST /api/eleven
//        { type:'suggest', to, film, why, by }   권하기
//        { type:'adopt',   to, id, by }          채택 (주인만)
//        { type:'drop',    to, by }              내리기 (주인만)
//        { type:'withdraw', id, by }             내가 한 추천 거두기
//
// 카드 자체는 건드리지 않습니다. 열한 번째는 따로 보관합니다 —
// 내가 고른 열 편과 남이 채워준 한 편은 성격이 다르기 때문입니다.

import { getStore, cleanName, loadSug,
         K_SUG_L, K_SUG_X, K_SUG_A } from './_store.js';

const NEED_STORAGE = { error: '저장소가 연결되지 않았습니다. (진단: /api/club?diag=1)' };
const WHY = 140;

export default async function handler(req, res) {
  const store = getStore();
  if (!store) return res.status(503).json(NEED_STORAGE);

  try {
    if (req.method === 'GET') return res.status(200).json(await loadSug(store));

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
    }

    const b = req.body || {};
    const by = cleanName(b.by);
    if (!by) return res.status(400).json({ error: '이름이 필요합니다.' });

    /* ── 권하기 ── */
    if (b.type === 'suggest') {
      const to = cleanName(b.to);
      const film = String(b.film || '').trim().slice(0, 120);
      const why = String(b.why || '').trim().slice(0, WHY);
      if (!to || !film) return res.status(400).json({ error: '대상과 영화가 필요합니다.' });
      if (to === by) return res.status(400).json({ error: '내 카드에는 권할 수 없습니다.' });

      const cur = await loadSug(store);
      if (cur.pending.some((x) => x.to === to && x.by === by)) {
        return res.status(409).json({ error: '이미 이 사람에게 한 편 권했습니다. 거두고 다시 권해주세요.' });
      }
      await store.rpush(K_SUG_L, {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        to, film, by, why, ts: Date.now(),
      });
      return res.status(200).json({ ok: true, ...(await loadSug(store)) });
    }

    /* ── 채택 (주인만) ── */
    if (b.type === 'adopt') {
      const to = cleanName(b.to);
      if (to !== by) return res.status(403).json({ error: '카드 주인만 채택할 수 있습니다.' });
      const cur = await loadSug(store);
      const hit = cur.pending.find((x) => x.id === String(b.id || '') && x.to === to);
      if (!hit) return res.status(404).json({ error: '없는 추천입니다.' });

      await store.hset(K_SUG_A, to, { film: hit.film, by: hit.by, why: hit.why, ts: Date.now() });
      await store.sadd(K_SUG_X, hit.id);          // 채택된 건 대기 목록에서 뺍니다
      return res.status(200).json({ ok: true, ...(await loadSug(store)) });
    }

    /* ── 내리기 (주인만) ── */
    if (b.type === 'drop') {
      const to = cleanName(b.to);
      if (to !== by) return res.status(403).json({ error: '카드 주인만 내릴 수 있습니다.' });
      await store.hdel(K_SUG_A, to);
      return res.status(200).json({ ok: true, ...(await loadSug(store)) });
    }

    /* ── 내가 한 추천 거두기 ── */
    if (b.type === 'withdraw') {
      const cur = await loadSug(store);
      const hit = cur.pending.find((x) => x.id === String(b.id || ''));
      if (!hit) return res.status(404).json({ error: '없는 추천입니다.' });
      if (hit.by !== by) return res.status(403).json({ error: '내가 한 추천만 거둘 수 있습니다.' });
      await store.lrem(K_SUG_L, hit);
      await store.sadd(K_SUG_X, hit.id);
      return res.status(200).json({ ok: true, ...(await loadSug(store)) });
    }

    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
