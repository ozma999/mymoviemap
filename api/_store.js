// 저장소 접속 공용 모듈.
// 파일 이름이 _ 로 시작하면 Vercel이 주소로 만들지 않고 '부품'으로만 씁니다.
//
// 접속 방식이 두 가지라 둘 다 지원합니다:
//   (A) REST — UPSTASH_REDIS_REST_URL / ..._TOKEN, KV_REST_API_URL / ..._TOKEN
//   (B) TCP  — REDIS_URL (rediss://...)   ← Vercel 마켓플레이스 연결은 보통 이것

import { Redis as UpstashRest } from '@upstash/redis';
import IORedis from 'ioredis';

const isHttp = (v) => typeof v === 'string' && /^https?:\/\//.test(v.trim());
const isTcp  = (v) => typeof v === 'string' && /^rediss?:\/\//.test(v.trim());

export function findConfig() {
  const e = process.env;

  const restPairs = [
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN'],
  ];
  for (const [u, t] of restPairs) {
    if (isHttp(e[u]) && e[t]) return { mode: 'rest', url: e[u].trim(), token: e[t], via: u };
  }
  const restKey = Object.keys(e).find((k) => /REST_API_URL$/.test(k) && isHttp(e[k]));
  if (restKey) {
    const base = restKey.slice(0, -'REST_API_URL'.length);
    const tk = [base + 'REST_API_TOKEN', base + 'REST_API_READ_WRITE_TOKEN'].find((k) => e[k]);
    if (tk) return { mode: 'rest', url: e[restKey].trim(), token: e[tk], via: restKey };
  }

  const tcpKey = ['REDIS_URL', 'KV_URL', 'UPSTASH_REDIS_URL'].find((k) => isTcp(e[k]))
    || Object.keys(e).find((k) => isTcp(e[k]));
  if (tcpKey) return { mode: 'tcp', url: e[tcpKey].trim(), via: tcpKey };

  return null;
}

// REST 쪽은 값을 알아서 객체로 풀어 주기도 하고 문자열로 주기도 해서, 둘 다 받아 넘깁니다.
const parse = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

let _client = null;
export function getStore() {
  if (_client) return _client;
  const cfg = findConfig();
  if (!cfg) return null;

  if (cfg.mode === 'rest') {
    const r = new UpstashRest({ url: cfg.url, token: cfg.token });
    _client = {
      via: cfg.via, mode: 'rest', raw: r,
      get:  async (k, d) => (await r.get(k)) ?? d,
      set:  async (k, v) => { await r.set(k, v); },
      hgetall: async (k) => {
        const o = (await r.hgetall(k)) || {};
        const out = {}; for (const f in o) { const v = parse(o[f]); if (v != null) out[f] = v; }
        return out;
      },
      hset: async (k, f, v) => { await r.hset(k, { [f]: JSON.stringify(v) }); },
      hdel: async (k, f) => { await r.hdel(k, f); },
      rpush: async (k, v) => { await r.rpush(k, JSON.stringify(v)); },
      lrange: async (k) => ((await r.lrange(k, 0, -1)) || []).map(parse).filter(Boolean),
      lrem: async (k, v) => { await r.lrem(k, 0, JSON.stringify(v)); },
      sadd: async (k, v) => { await r.sadd(k, String(v)); },
      smembers: async (k) => ((await r.smembers(k)) || []).map(String),
    };
  } else {
    const r = new IORedis(cfg.url, { maxRetriesPerRequest: 3, connectTimeout: 8000 });
    r.on('error', () => {});
    _client = {
      via: cfg.via, mode: 'tcp', raw: r,
      get: async (k, d) => { const raw = await r.get(k); return raw == null ? d : (parse(raw) ?? d); },
      set: async (k, v) => { await r.set(k, JSON.stringify(v)); },
      hgetall: async (k) => {
        const o = (await r.hgetall(k)) || {};
        const out = {}; for (const f in o) { const v = parse(o[f]); if (v != null) out[f] = v; }
        return out;
      },
      hset: async (k, f, v) => { await r.hset(k, f, JSON.stringify(v)); },
      hdel: async (k, f) => { await r.hdel(k, f); },
      rpush: async (k, v) => { await r.rpush(k, JSON.stringify(v)); },
      lrange: async (k) => ((await r.lrange(k, 0, -1)) || []).map(parse).filter(Boolean),
      lrem: async (k, v) => { await r.lrem(k, 0, JSON.stringify(v)); },
      sadd: async (k, v) => { await r.sadd(k, String(v)); },
      smembers: async (k) => ((await r.smembers(k)) || []).map(String),
    };
  }
  return _client;
}

/* ── 저장 위치 ──────────────────────────────────────────────────
   카드는 '한 덩어리 배열'이 아니라 사람마다 한 칸(해시 필드)에 넣습니다.
   한 덩어리로 두면 누가 카드를 낼 때마다 전체를 통째로 덮어쓰기 때문에,
   두 사람이 거의 동시에 내면 한쪽이 통째로 사라질 수 있습니다.
   ────────────────────────────────────────────────────────────── */
export const K_MEMBERS_H = 'movie_dna:members_h';   // 해시: 이름 → 카드
export const K_MEMBERS   = 'movie_dna:members';     // (구버전) 배열 — 읽기 전용·백업으로만 남겨 둠
export const K_POSTERS   = 'movie_dna:posters';
export const K_NOTES_L   = 'movie_dna:notes_l';     // 리스트: 메모를 뒤에 덧붙이기만
export const K_NOTES     = 'movie_dna:notes';       // (구버전) 배열
export const K_NOTES_X   = 'movie_dna:notes_x';     // 지운 메모 id 목록(구버전 것도 확실히 지우기 위해)
export const K_STAMPS_H  = 'movie_dna:stamps_h';    // 해시: "이름|영화" → 도장
export const K_STAMPS    = 'movie_dna:stamps';      // (구버전) 통짜 객체 — 읽기 전용
export const K_BLIND     = 'movie_dna:blind_h';     // 해시: 블라인드 기록
//   s|이름 → { best, plays }        그 사람의 최고 점수
//   c|이름 → { right, wrong }       그 사람 카드를 남들이 얼마나 맞혔나
export const K_DUEL      = 'movie_dna:duel_h';      // 해시: 양자택일 집계
//   f|제목        → { win, loss }
//   p|A@@B        → { [제목]: 표수 }  그 대결의 클럽 성적
export const K_SUG_L     = 'movie_dna:sug_l';       // 리스트: 들어온 추천 (덧붙이기만)
export const K_SUG_X     = 'movie_dna:sug_x';       // 내려간 추천 id
export const K_SUG_A     = 'movie_dna:sug_a';       // 해시: 이름 → 채택한 열한 번째

/* 추천도 메모와 같은 방식 — 리스트에 덧붙이고, 내린 건 표시로 걸러냅니다. */
export async function loadSug(store) {
  const [list, gone, adopted] = await Promise.all([
    store.lrange(K_SUG_L),
    store.smembers(K_SUG_X),
    store.hgetall(K_SUG_A),
  ]);
  const dead = new Set(gone || []);
  return {
    pending: (list || []).filter((x) => x && x.id && !dead.has(x.id))
                          .sort((a, b) => (a.ts || 0) - (b.ts || 0)),
    adopted: adopted || {},
  };
}

/* 구버전 배열에 남아 있는 카드를 해시로 옮겨 옵니다(한 번만, 자동).
   덮어쓰지 않고 '해시에 없는 것만' 채워 넣으므로 안전합니다. */
export async function loadMembers(store) {
  const h = await store.hgetall(K_MEMBERS_H);
  const legacy = (await store.get(K_MEMBERS, [])) || [];
  let moved = 0;
  for (const m of legacy) {
    if (m && m.id && !h[m.id]) { await store.hset(K_MEMBERS_H, m.id, m); h[m.id] = m; moved++; }
  }
  const list = Object.values(h).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return { list, moved, legacyCount: legacy.length };
}

export async function loadNotes(store) {
  const [fresh, legacy, gone] = await Promise.all([
    store.lrange(K_NOTES_L),
    store.get(K_NOTES, []),
    store.smembers(K_NOTES_X),
  ]);
  const dead = new Set(gone || []);
  const seen = new Set(fresh.map((n) => n.id));
  const merged = fresh.concat((legacy || []).filter((n) => n && n.id && !seen.has(n.id)));
  return merged.filter((n) => !dead.has(n.id)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

/* 이름은 저장 키의 구분자로도 쓰이므로 파이프(|)를 허용하지 않습니다. */
export const cleanName = (v) => String(v || '').replace(/\|/g, '').replace(/\s+/g, ' ').trim();
