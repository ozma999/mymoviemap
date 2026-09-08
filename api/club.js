// 멤버 카드 저장·조회.
//   GET  /api/club          → 카드 전체 (+ 포스터 캐시)
//   GET  /api/club?diag=1   → 저장소 진단. 몇 장이 실제로 들어 있는지까지 보여줍니다
//   POST /api/club          → 카드 한 장 저장 (그 사람 칸만 건드립니다)

import { getStore, findConfig, loadMembers, cleanName,
         K_MEMBERS_H, K_MEMBERS, K_POSTERS, K_FAME } from './_store.js';

const NEED_STORAGE = {
  error:
    '저장소가 연결되지 않았습니다. Vercel 프로젝트 → Storage 탭에서 Redis를 연결한 뒤, ' +
    'Deployments 탭에서 Redeploy를 한 번 해주세요. (진단: /api/club?diag=1)',
};

export default async function handler(req, res) {
  /* ── 진단 ── */
  if (req.method === 'GET' && req.query && req.query.diag === '1') {
    const cfg = findConfig();
    const names = Object.keys(process.env)
      .filter((k) => /(REDIS|UPSTASH|KV_|STORAGE)/i.test(k)).sort();
    const out = {
      연결됨: !!cfg,
      접속방식: cfg ? (cfg.mode === 'rest' ? 'REST (https)' : 'TCP (rediss)') : null,
      사용중인_변수: cfg ? cfg.via : null,
      TMDB_열쇠_꽂힘: !!(process.env.TMDB_KEY || process.env.TMDB_API_KEY),
      발견된_저장소_관련_변수이름: names,
    };
    if (cfg) {
      try {
        const store = getStore();
        const h = await store.hgetall(K_MEMBERS_H);
        const legacy = (await store.get(K_MEMBERS, [])) || [];
        out.저장된_카드_수 = Object.keys(h).length;
        out.카드_이름 = Object.keys(h);
        out.구버전_배열에_남은_카드_수 = legacy.length;
        out.구버전_카드_이름 = legacy.map((m) => m && m.id).filter(Boolean);
        out.실제_읽기_테스트 = '읽기 성공';
      } catch (e) {
        out.실제_읽기_테스트 = '읽기 실패: ' + String((e && e.message) || e);
      }
    }
    return res.status(200).json(out);
  }

  const store = getStore();
  if (!store) return res.status(503).json(NEED_STORAGE);

  try {
    if (req.method === 'GET') {
      const [{ list }, posters, fame] = await Promise.all([
        loadMembers(store),
        store.get(K_POSTERS, {}),
        store.get(K_FAME, {}),
      ]);
      return res.status(200).json({ members: list, posters: posters || {}, fame: fame || {} });
    }

    if (req.method === 'POST') {
      const { name, works, tags, decl } = req.body || {};
      if (!name || !Array.isArray(works) || works.length === 0) {
        return res.status(400).json({ error: '이름과 작품 목록(1편 이상)이 필요합니다.' });
      }
      const id = cleanName(name);
      if (!id) return res.status(400).json({ error: '이름이 비어 있습니다.' });

      // 먼저 구버전 배열이 있으면 해시로 옮겨 둡니다(있는 것만 채움, 덮어쓰지 않음).
      await loadMembers(store);

      const rec = {
        id, name: id,
        works: works.map((w) => ({
          t: String(w.t || '').slice(0, 120),
          mood: Math.min(5, Math.max(1, +w.mood || 3)),
          tmdb: w.tmdb || null,
          dir: w.dir ? String(w.dir).slice(0, 80) : '',    // 유사도 계산에 씁니다
          year: +w.year || null,
        })),
        // 빈 값·중복이 섞여 들어오면 여기서 걸러 냅니다.
        tags: Array.isArray(tags)
          ? [...new Set(tags.filter((x) => typeof x === 'string' && x.trim())
                            .map((x) => x.trim().slice(0, 40)))].slice(0, 12)
          : [],
        decl: String(decl || '').slice(0, 120),
        ts: Date.now(),
      };

      // 이 사람 칸만 씁니다. 다른 사람 카드는 건드리지 않습니다.
      await store.hset(K_MEMBERS_H, id, rec);

      // 이번 제출에 쓰인 포스터를 공용 캐시에 합칩니다.
      const add = {};
      works.forEach((w) => { if (w.t && w.poster) add[w.t] = w.poster; });
      if (Object.keys(add).length) {
        const cur = (await store.get(K_POSTERS, {})) || {};
        await store.set(K_POSTERS, { ...cur, ...add });
      }

      const [{ list }, posters, fame] = await Promise.all([
        loadMembers(store),
        store.get(K_POSTERS, {}),
        store.get(K_FAME, {}),
      ]);
      return res.status(200).json({ ok: true, members: list, posters: posters || {}, fame: fame || {} });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
