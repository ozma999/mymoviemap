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

import { getStore, K_NOTES, K_STAMPS } from './_store.js';

export const STAMPS = ['나도', '이건 봐야겠다', '의외다'];
const LIMIT = 300;   // 메모 길이 상한

const NEED_STORAGE = {
  error: '저장소가 연결되지 않았습니다. (진단: /api/club?diag=1)',
};

const key = (to, film) => `${to}|${film}`;

export default async function handler(req, res) {
  const store = getStore();
  if (!store) return res.status(503).json(NEED_STORAGE);

  try {
    if (req.method === 'GET') {
      const [notes, stamps] = await Promise.all([
        store.get(K_NOTES, []),
        store.get(K_STAMPS, {}),
      ]);
      return res.status(200).json({ notes: notes || [], stamps: stamps || {} });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
    }

    const b = req.body || {};
    const by = String(b.by || '').trim();
    if (!by) return res.status(400).json({ error: '이름이 필요합니다.' });

    /* ── 메모 남기기 ── */
    if (b.type === 'note') {
      const to = String(b.to || '').trim();
      const film = String(b.film || '').trim();
      const text = String(b.text || '').trim().slice(0, LIMIT);
      if (!to || !film) return res.status(400).json({ error: '대상이 없습니다.' });
      if (!text) return res.status(400).json({ error: '내용이 비어 있습니다.' });

      const notes = (await store.get(K_NOTES, [])) || [];
      notes.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        to, film, by, text, ts: Date.now(),
      });
      // 너무 커지지 않도록 최근 2000개만 유지
      await store.set(K_NOTES, notes.slice(-2000));
      const stamps = (await store.get(K_STAMPS, {})) || {};
      return res.status(200).json({ ok: true, notes: notes.slice(-2000), stamps });
    }

    /* ── 도장 (토글) ── */
    if (b.type === 'stamp') {
      const to = String(b.to || '').trim();
      const film = String(b.film || '').trim();
      const kind = String(b.kind || '');
      if (!to || !film) return res.status(400).json({ error: '대상이 없습니다.' });
      if (!STAMPS.includes(kind)) return res.status(400).json({ error: '없는 도장입니다.' });

      const stamps = (await store.get(K_STAMPS, {})) || {};
      const k = key(to, film);
      const cell = stamps[k] || {};
      const list = cell[kind] || [];
      cell[kind] = list.includes(by) ? list.filter((n) => n !== by) : list.concat(by);
      if (!cell[kind].length) delete cell[kind];
      if (Object.keys(cell).length) stamps[k] = cell; else delete stamps[k];

      await store.set(K_STAMPS, stamps);
      const notes = (await store.get(K_NOTES, [])) || [];
      return res.status(200).json({ ok: true, notes, stamps });
    }

    /* ── 내가 쓴 메모 지우기 ── */
    if (b.type === 'del') {
      const id = String(b.id || '');
      const notes = (await store.get(K_NOTES, [])) || [];
      const hit = notes.find((n) => n.id === id);
      if (!hit) return res.status(404).json({ error: '없는 메모입니다.' });
      if (hit.by !== by) return res.status(403).json({ error: '내가 쓴 메모만 지울 수 있습니다.' });

      const next = notes.filter((n) => n.id !== id);
      await store.set(K_NOTES, next);
      const stamps = (await store.get(K_STAMPS, {})) || {};
      return res.status(200).json({ ok: true, notes: next, stamps });
    }

    return res.status(400).json({ error: '알 수 없는 요청입니다.' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
