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

let _client = null;
export function getStore() {
  if (_client) return _client;
  const cfg = findConfig();
  if (!cfg) return null;

  if (cfg.mode === 'rest') {
    const r = new UpstashRest({ url: cfg.url, token: cfg.token });
    _client = {
      via: cfg.via, mode: 'rest',
      get: async (k, d) => (await r.get(k)) ?? d,
      set: async (k, v) => { await r.set(k, v); },
    };
  } else {
    const r = new IORedis(cfg.url, { maxRetriesPerRequest: 3, connectTimeout: 8000 });
    r.on('error', () => {});
    _client = {
      via: cfg.via, mode: 'tcp',
      get: async (k, d) => {
        const raw = await r.get(k);
        if (raw == null) return d;
        try { return JSON.parse(raw); } catch { return d; }
      },
      set: async (k, v) => { await r.set(k, JSON.stringify(v)); },
    };
  }
  return _client;
}

export const K_MEMBERS = 'movie_dna:members';
export const K_POSTERS = 'movie_dna:posters';
