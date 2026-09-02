// 서버 역할 파일.
//   GET  /api/club          → 제출된 멤버 전체
//   GET  /api/club?diag=1   → 저장소 연결 진단 (값이 아니라 '변수 이름'만 보여줌)
//   POST /api/club          → 멤버 저장
//
// Vercel은 api/ 폴더의 .js 파일을 자동으로 서버리스 함수로 인식합니다.

import { Redis } from '@upstash/redis';

const KEY = 'movie_dna:members';

/* ────────────────────────────────────────────────────────────────
   저장소 접속 정보 찾기

   Upstash를 Vercel에 연결하면 접속 주소와 비밀키가 '환경변수'로 들어오는데,
   그 이름이 연결 방식에 따라 다릅니다:
     - UPSTASH_REDIS_REST_URL / ..._TOKEN     (Upstash 직접 연결)
     - KV_REST_API_URL / KV_REST_API_TOKEN    (Vercel 마켓플레이스 연결 ← 대부분 이것)
     - 프로젝트 이름이 접두어로 붙는 경우도 있음
   그래서 이름을 하나로 못 박지 않고, 있는 것을 찾아 씁니다.
   ──────────────────────────────────────────────────────────────── */
const isUrl = (v) => typeof v === 'string' && /^https?:\/\//.test(v.trim());

function resolveRedis() {
  const e = process.env;

  const known = [
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN'],
  ];
  for (const [u, t] of known) {
    if (isUrl(e[u]) && e[t]) return { url: e[u].trim(), token: e[t], via: u };
  }

  // 접두어가 붙어 있어도 찾아내기 (예: MYMOVIEMAP_KV_REST_API_URL)
  const urlKey = Object.keys(e).find((k) => /REST_API_URL$/.test(k) && isUrl(e[k]));
  if (urlKey) {
    const base = urlKey.slice(0, -'REST_API_URL'.length);
    const tokKey = [
      base + 'REST_API_TOKEN',
      base + 'REST_API_READ_WRITE_TOKEN',
    ].find((k) => e[k]);
    if (tokKey) return { url: e[urlKey].trim(), token: e[tokKey], via: urlKey };
  }

  return null;
}

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const cfg = resolveRedis();
  if (!cfg) return null;
  _redis = new Redis({ url: cfg.url, token: cfg.token });
  _redis.__via = cfg.via;
  return _redis;
}

const NEED_STORAGE = {
  error:
    '저장소가 연결되지 않았습니다. Vercel 프로젝트 → Storage 탭에서 Upstash Redis를 연결한 뒤, ' +
    'Deployments 탭에서 Redeploy를 한 번 해주세요. ' +
    '(자세한 진단: 주소 끝에 /api/club?diag=1 을 붙여 열어보세요)',
};

export default async function handler(req, res) {
  // ── 진단 모드 ────────────────────────────────────────────────
  // 비밀키 '값'은 절대 내보내지 않고, 어떤 '이름'의 변수가 들어와 있는지만 보여줍니다.
  if (req.method === 'GET' && req.query && req.query.diag === '1') {
    const cfg = resolveRedis();
    const names = Object.keys(process.env)
      .filter((k) => /(REDIS|UPSTASH|KV_|STORAGE)/i.test(k))
      .sort();
    return res.status(200).json({
      연결됨: !!cfg,
      사용중인_변수: cfg ? cfg.via : null,
      발견된_저장소_관련_변수이름: names,
      안내: cfg
        ? '정상입니다. 제출이 안 되면 Redeploy를 한 번 해보세요.'
        : '위 목록이 비어 있으면 Storage 연결이 안 된 것이고, 이름은 있는데 연결이 안 됐다면 그 이름을 알려주세요.',
    });
  }

  const redis = getRedis();
  if (!redis) return res.status(503).json(NEED_STORAGE);

  try {
    if (req.method === 'GET') {
      const members = (await redis.get(KEY)) || [];
      return res.status(200).json({ members });
    }

    if (req.method === 'POST') {
      const { name, works, tags, decl } = req.body || {};
      if (!name || !Array.isArray(works) || works.length === 0) {
        return res.status(400).json({ error: '이름과 작품 목록(1편 이상)이 필요합니다.' });
      }
      const id = String(name).trim();
      if (!id) return res.status(400).json({ error: '이름이 비어 있습니다.' });

      const members = (await redis.get(KEY)) || [];
      const rec = {
        id,
        name: id,
        works,                                  // [{ t: '기생충', mood: 4 }, ...]
        tags: Array.isArray(tags) ? tags : [],  // 장르·성향
        decl: String(decl || '').slice(0, 120), // 한 줄
        ts: Date.now(),
      };
      const next = members.filter((m) => m.id !== id).concat(rec);

      await redis.set(KEY, next);
      return res.status(200).json({ ok: true, members: next });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
