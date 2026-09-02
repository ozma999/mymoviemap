// 이 파일 하나가 "서버"입니다.
// GET  /api/club  → 지금까지 제출된 멤버 전체를 돌려줍니다
// POST /api/club  → 새 멤버(또는 수정)를 저장합니다
//
// Vercel은 api/ 폴더 안의 .js 파일을 자동으로 "서버리스 함수"로 인식합니다.
// 즉, 이 파일을 따로 실행시켜둘 필요 없이 폴더에 넣기만 하면
// https://내주소.vercel.app/api/club 요청이 올 때마다 Vercel이 알아서 실행해줍니다.

import { Redis } from '@upstash/redis';

// Redis.fromEnv()는 Vercel 프로젝트에 Upstash를 연결했을 때
// 자동으로 생겨나는 환경변수(주소·비밀키)를 스스로 찾아 읽습니다.
// 코드에는 실제 비밀번호가 전혀 적히지 않습니다.
const redis = Redis.fromEnv();

const KEY = 'movie_dna:members';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const members = (await redis.get(KEY)) || [];
      return res.status(200).json({ members });
    }

    if (req.method === 'POST') {
      const { name, works } = req.body || {};
      if (!name || !Array.isArray(works) || works.length === 0) {
        return res.status(400).json({ error: '이름과 작품 목록(1편 이상)이 필요합니다.' });
      }
      const id = String(name).trim();
      if (!id) return res.status(400).json({ error: '이름이 비어 있습니다.' });

      const members = (await redis.get(KEY)) || [];
      const rec = { id, name: id, works, ts: Date.now() };
      // 같은 이름이 이미 있으면 덮어쓰고, 없으면 새로 추가
      const next = members.filter((m) => m.id !== id).concat(rec);

      await redis.set(KEY, next);
      return res.status(200).json({ ok: true, members: next });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
  } catch (e) {
    // 여기로 떨어지면 대부분 Upstash 연결이 안 된 경우입니다.
    // → Vercel 프로젝트에 Storage(Upstash Redis)를 연결했는지 확인하세요.
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
