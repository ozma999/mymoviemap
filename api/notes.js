// 메모와 도장.
//
//   GET  /api/notes   → 전체 메모 + 도장
//   POST /api/notes   → 아래 셋 중 하나
//        { type:'note',  to, film, by, text }   메모 남기기
//        { type:'stamp', to, film, by, kind }   도장 (다시 누르면 취소)
//        { type:'del',   id, by }               내가 쓴 메모 지우기
//
// 메모는 '누구의 카드에 있는 어떤 영화'에 붙습니다.
// 카드 전체가 아니라 한 편에 붙어야 할 말이 생깁니다.
//
// 메모는 리스트에 '뒤에 덧붙이기'만 합니다. 전체를 다시 쓰지 않으므로
// 여러 사람이 동시에 남겨도 서로의 메모를 지우지 않습니다.

import { getStore, loadNotes, cleanName,
         K_NOTES_L, K_NOTES_X, K_STAMPS_H, K_STAMPS } from './_store.js';

export const STAMPS = ['나도', '이건 봐야겠다', '의외다'];
const LIMIT = 300;

const NEED_STORAGE = { error: '저장소가 연결되지 않았습니다. (진단: /api/club?diag=1)' };
const key = (to, film) => `${to}|${film}`;

async function readAll(store) {
  // 새 해시(칸별)와 구버전 통짜 객체를 함께 읽어 합칩니다. 새 쪽이 우선입니다.
  const [notes, fresh, legacy] = await Promise.all([
    loadNotes(store),
    store.hgetall(K_STAMPS_H),
    store.get(K_STAMPS, {}),
  ]);
  const base = (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) ? legacy : {};
  return { notes, stamps: { ...base, ...fresh } };
}

export default async function handler(req, res) {
  const store = getStore();
  if (!store) return res.status(503).json(NEED_STORAGE);

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await readAll(store));
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
    }

    const b = req.body || {};
    const by = cleanName(b.by);
    if (!by) return res.status(400).json({ error: '이름이 필요합니다.' });

    /* ── 메모 남기기 : 리스트에 덧붙이기만 ── */
    if (b.type === 'note') {
      const to = cleanName(b.to);
      const film = String(b.film || '').trim();
      const text = String(b.text || '').trim().slice(0, LIMIT);
      if (!to || !film) return res.status(400).json({ error: '대상이 없습니다.' });
      if (!text) return res.status(400).json({ error: '내용이 비어 있습니다.' });

      await store.rpush(K_NOTES_L, {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        to, film, by, text, ts: Date.now(),
      });
      return res.status(200).json({ ok: true, ...(await readAll(store)) });
    }

    /* ── 도장 (토글) : 그 영화 칸만 건드림 ── */
    if (b.type === 'stamp') {
      const to = cleanName(b.to);
      const film = String(b.film || '').trim();
      const kind = String(b.kind || '');
      if (!to || !film) return res.status(400).json({ error: '대상이 없습니다.' });
      if (!STAMPS.includes(kind)) return res.status(400).json({ error: '없는 도장입니다.' });

      const k = key(to, film);
      const all = (await readAll(store)).stamps;
      const cell = { ...(all[k] || {}) };
      const list = cell[kind] || [];
      cell[kind] = list.includes(by) ? list.filter((n) => n !== by) : list.concat(by);
      if (!cell[kind].length) delete cell[kind];

      if (Object.keys(cell).length) await store.hset(K_STAMPS_H, k, cell);
      else await store.hdel(K_STAMPS_H, k);

      return res.status(200).json({ ok: true, ...(await readAll(store)) });
    }

    /* ── 내가 쓴 메모 지우기 ── */
    if (b.type === 'del') {
      const id = String(b.id || '');
      const notes = await loadNotes(store);
      const hit = notes.find((n) => n.id === id);
      if (!hit) return res.status(404).json({ error: '없는 메모입니다.' });
      if (hit.by !== by) return res.status(403).json({ error: '내가 쓴 메모만 지울 수 있습니다.' });

      // 리스트에서 빼고, 지운 표시도 남깁니다.
      // (구버전 배열에 있던 메모는 리스트에 없으므로 이 표시가 있어야 확실히 사라집니다)
      await store.lrem(K_NOTES_L, hit);
      await store.sadd(K_NOTES_X, hit.id);
      return res.status(200).json({ ok: true, ...(await readAll(store)) });
    }

    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
