// 멤버 카드 저장·조회.
//   GET  /api/club          → 제출된 멤버 전체 (+ 포스터 캐시)
//   GET  /api/club?diag=1   → 저장소 연결 진단 (비밀키 '값'은 안 나오고 '이름'만)
//   POST /api/club          → 멤버 저장

import { getStore, findConfig, K_MEMBERS, K_POSTERS } from './_store.js';

const NEED_STORAGE = {
  error:
    '저장소가 연결되지 않았습니다. Vercel 프로젝트 → Storage 탭에서 Redis를 연결한 뒤, ' +
    'Deployments 탭에서 Redeploy를 한 번 해주세요. ' +
    '(진단: 주소 끝에 /api/club?diag=1 을 붙여 열어보세요)',
};

export default async function handler(req, res) {
  /* ── 진단 ── */
  if (req.method === 'GET' && req.query && req.query.diag === '1') {
    const cfg = findConfig();
    const names = Object.keys(process.env)
      .filter((k) => /(REDIS|UPSTASH|KV_|STORAGE)/i.test(k)).sort();
    let ping = null;
    if (cfg) {
      try { await getStore().get(K_MEMBERS, []); ping = '읽기 성공'; }
      catch (e) { ping = '읽기 실패: ' + String((e && e.message) || e); }
    }
    return res.status(200).json({
      연결됨: !!cfg,
      접속방식: cfg ? (cfg.mode === 'rest' ? 'REST (https)' : 'TCP (rediss)') : null,
      사용중인_변수: cfg ? cfg.via : null,
      실제_읽기_테스트: ping,
      TMDB_열쇠_꽂힘: !!(process.env.TMDB_KEY || process.env.TMDB_API_KEY),
      발견된_저장소_관련_변수이름: names,
    });
  }

  const store = getStore();
  if (!store) return res.status(503).json(NEED_STORAGE);

  try {
    if (req.method === 'GET') {
      const [members, posters] = await Promise.all([
        store.get(K_MEMBERS, []),
        store.get(K_POSTERS, {}),
      ]);
      return res.status(200).json({ members: members || [], posters: posters || {} });
    }

    if (req.method === 'POST') {
      const { name, works, tags, decl } = req.body || {};
      if (!name || !Array.isArray(works) || works.length === 0) {
        return res.status(400).json({ error: '이름과 작품 목록(1편 이상)이 필요합니다.' });
      }
      const id = String(name).trim();
      if (!id) return res.status(400).json({ error: '이름이 비어 있습니다.' });

      const members = (await store.get(K_MEMBERS, [])) || [];
      const rec = {
        id, name: id,
        works: works.map((w) => ({
          t: String(w.t || '').slice(0, 120),
          mood: Math.min(5, Math.max(1, +w.mood || 3)),
          tmdb: w.tmdb || null,
        })),
        tags: Array.isArray(tags) ? tags : [],
        decl: String(decl || '').slice(0, 120),
        ts: Date.now(),
      };
      const next = members.filter((m) => m.id !== id).concat(rec);
      await store.set(K_MEMBERS, next);

      // 이번 제출에 쓰인 포스터를 공용 캐시에 합쳐 둔다
      const add = {};
      works.forEach((w) => { if (w.t && w.poster) add[w.t] = w.poster; });
      if (Object.keys(add).length) {
        const cur = (await store.get(K_POSTERS, {})) || {};
        await store.set(K_POSTERS, { ...cur, ...add });
      }

      const posters = (await store.get(K_POSTERS, {})) || {};
      return res.status(200).json({ ok: true, members: next, posters });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
