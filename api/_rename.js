// 카드 이름 바꾸기 / 카드 지우기.
//
// 이름은 이 서비스의 '열쇠'입니다. 카드뿐 아니라 메모·도장·블라인드 기록·
// 열한 번째 자리 추천에 모두 이름이 박혀 있습니다. 한 군데만 고치면
// 나머지가 옛 이름을 가리키는 미아가 됩니다. 그래서 한 번에 같이 옮깁니다.
//
// 메모·추천은 '덧붙이기 전용' 리스트라 통째로 다시 쓰지 않고,
// 해당 항목만 빼고(lrem) 고쳐서 다시 넣습니다(rpush).

import {
  loadMembers, loadNotes, loadSug,
  K_MEMBERS_H, K_MEMBERS, K_NOTES_L, K_NOTES_X, K_STAMPS_H, K_STAMPS,
  K_BLIND, K_SUG_L, K_SUG_X, K_SUG_A,
} from './_store.js';

/* 그 이름에 매달린 것이 몇 개인지 — 지우기 전에 보여 줄 숫자입니다. */
export async function impactOf(store, name) {
  const [{ list }, notes, sug, stampsH, stampsL, blind] = await Promise.all([
    loadMembers(store), loadNotes(store), loadSug(store),
    store.hgetall(K_STAMPS_H), store.get(K_STAMPS, {}), store.hgetall(K_BLIND),
  ]);
  const stamps = { ...(stampsL && typeof stampsL === 'object' && !Array.isArray(stampsL) ? stampsL : {}), ...stampsH };
  const card = list.find((m) => m.id === name) || null;

  let stampOn = 0, stampBy = 0;
  for (const f of Object.keys(stamps)) {
    if (f.startsWith(name + '|')) stampOn++;
    const cell = stamps[f] || {};
    for (const k of Object.keys(cell)) if ((cell[k] || []).includes(name)) stampBy++;
  }
  return {
    있음: !!card,
    영화_수: card ? (card.works || []).length : 0,
    내_카드에_붙은_메모: notes.filter((n) => n.to === name).length,
    내가_남긴_메모: notes.filter((n) => n.by === name).length,
    내_카드의_도장_칸: stampOn,
    내가_찍은_도장: stampBy,
    받은_추천: sug.pending.filter((x) => x.to === name).length,
    내가_한_추천: sug.pending.filter((x) => x.by === name).length,
    채택한_열한번째: sug.adopted[name] ? 1 : 0,
    블라인드_기록: (blind['s|' + name] ? 1 : 0) + (blind['c|' + name] ? 1 : 0),
  };
}

/* 리스트(메모·추천)에서 해당 항목을 고쳐 넣습니다.
   구버전 배열에만 있던 것은 리스트에 없으므로, 옛 id를 무덤에 넣고
   새 id로 다시 넣습니다(같은 id로 넣으면 무덤에 걸려 같이 사라집니다). */
async function fixList(store, listKey, tombKey, items, inList, change) {
  let n = 0;
  for (const it of items) {
    const next = change(it);
    if (!next) continue;
    if (inList.has(it.id)) {
      await store.lrem(listKey, it);
      await store.rpush(listKey, { ...next, id: it.id });
    } else {
      await store.sadd(tombKey, it.id);
      await store.rpush(listKey, { ...next, id: it.id + '~r' });
    }
    n++;
  }
  return n;
}
async function dropList(store, listKey, tombKey, items, inList) {
  let n = 0;
  for (const it of items) {
    if (inList.has(it.id)) await store.lrem(listKey, it);
    await store.sadd(tombKey, it.id);      // 구버전에 남아 있어도 확실히 가려집니다
    n++;
  }
  return n;
}

/* 도장은 "이름|영화" 칸 이름에도, 칸 안의 '찍은 사람' 목록에도 이름이 있습니다. */
async function fixStamps(store, from, to) {
  const h = await store.hgetall(K_STAMPS_H);
  const legacy = await store.get(K_STAMPS, {});
  const base = (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) ? legacy : {};
  const all = { ...base, ...h };
  // 지울 때는 '빼기', 바꿀 때는 '갈아끼우기'. 순서를 섞으면 null 이 남습니다.
  const swapBy = (cell) => {
    const out = {};
    for (const k of Object.keys(cell || {})) {
      const arr = cell[k] || [];
      const next = to === null
        ? arr.filter((x) => x !== from)
        : [...new Set(arr.map((x) => (x === from ? to : x)))];
      if (next.length) out[k] = next;          // 빈 칸은 남기지 않습니다
    }
    return out;
  };
  const isEmpty = (cell) => !Object.keys(cell || {}).length;
  let n = 0;
  for (const f of Object.keys(all)) {
    const mine = f.startsWith(from + '|');
    const cell = all[f] || {};
    const touched = mine || Object.keys(cell).some((k) => (cell[k] || []).includes(from));
    if (!touched) continue;

    if (mine) await store.hdel(K_STAMPS_H, f);
    if (to === null) {
      if (!mine) {
        const next = swapBy(cell);                                 // 남의 칸에서 내 도장만 뺍니다
        if (isEmpty(next)) await store.hdel(K_STAMPS_H, f);
        else await store.hset(K_STAMPS_H, f, next);
      }
    } else {
      const nf = mine ? to + f.slice(from.length) : f;
      await store.hset(K_STAMPS_H, nf, swapBy(cell));
    }
    n++;
  }
  // 구버전 통짜 객체는 한 번에 다시 씁니다(읽기 전용 백업이라 안전합니다).
  if (Object.keys(base).length) {
    const nb = {};
    for (const f of Object.keys(base)) {
      const mine = f.startsWith(from + '|');
      if (mine && to === null) continue;
      const nf = mine && to ? to + f.slice(from.length) : f;
      const next = swapBy(base[f]);
      if (!isEmpty(next)) nb[nf] = next;
    }
    await store.set(K_STAMPS, nb);
  }
  return n;
}

async function fixBlind(store, from, to) {
  const h = await store.hgetall(K_BLIND);
  let n = 0;
  for (const p of ['s|', 'c|']) {
    const v = h[p + from];
    if (v === undefined) continue;
    await store.hdel(K_BLIND, p + from);
    if (to !== null) await store.hset(K_BLIND, p + to, v);
    n++;
  }
  return n;
}

/* 구버전 배열에도 같은 이름이 남아 있으면 되살아납니다. 같이 손봅니다. */
async function fixLegacyMembers(store, from, to) {
  const legacy = (await store.get(K_MEMBERS, [])) || [];
  if (!legacy.length) return;
  const next = to === null
    ? legacy.filter((m) => !m || m.id !== from)
    : legacy.map((m) => (m && m.id === from ? { ...m, id: to, name: to } : m));
  await store.set(K_MEMBERS, next);
}

/* ── 이름만 바꾸기 ── */
export async function renameCard(store, from, to) {
  const { list } = await loadMembers(store);
  const card = list.find((m) => m.id === from);
  if (!card) return { error: `「${from}」 카드를 찾지 못했습니다.` };
  if (list.some((m) => m.id === to)) return { error: `「${to}」 이름은 이미 쓰고 있습니다. 다른 이름으로 해주세요.` };

  const [notes, sug, rawNotes, rawSug] = await Promise.all([
    loadNotes(store), loadSug(store), store.lrange(K_NOTES_L), store.lrange(K_SUG_L),
  ]);
  const inNotes = new Set(rawNotes.map((x) => x.id));
  const inSug = new Set(rawSug.map((x) => x.id));

  await store.hset(K_MEMBERS_H, to, { ...card, id: to, name: to });
  await store.hdel(K_MEMBERS_H, from);
  await fixLegacyMembers(store, from, to);

  const swap = (x) => (x === from ? to : x);
  const nN = await fixList(store, K_NOTES_L, K_NOTES_X,
    notes.filter((n) => n.to === from || n.by === from), inNotes,
    (n) => ({ ...n, to: swap(n.to), by: swap(n.by) }));
  const nS = await fixList(store, K_SUG_L, K_SUG_X,
    sug.pending.filter((x) => x.to === from || x.by === from), inSug,
    (x) => ({ ...x, to: swap(x.to), by: swap(x.by) }));

  const nT = await fixStamps(store, from, to);
  const nB = await fixBlind(store, from, to);

  // 채택한 열한 번째 — 칸 이름(주인)과 추천인 이름 둘 다
  const ad = await store.hgetall(K_SUG_A);
  let nA = 0;
  for (const owner of Object.keys(ad)) {
    const v = ad[owner] || {};
    const newOwner = swap(owner), newBy = swap(v.by);
    if (newOwner === owner && newBy === v.by) continue;
    if (newOwner !== owner) await store.hdel(K_SUG_A, owner);
    await store.hset(K_SUG_A, newOwner, { ...v, by: newBy });
    nA++;
  }
  return { ok: true, 바뀐_이름: `${from} → ${to}`,
    옮긴_메모: nN, 옮긴_추천: nS, 옮긴_도장_칸: nT, 옮긴_블라인드: nB, 옮긴_열한번째: nA };
}

/* ── 카드 지우기 ── 그 이름에 달린 것을 함께 지웁니다. */
export async function deleteCard(store, name) {
  const { list } = await loadMembers(store);
  if (!list.some((m) => m.id === name)) return { error: `「${name}」 카드를 찾지 못했습니다.` };

  const [notes, sug, rawNotes, rawSug] = await Promise.all([
    loadNotes(store), loadSug(store), store.lrange(K_NOTES_L), store.lrange(K_SUG_L),
  ]);
  const inNotes = new Set(rawNotes.map((x) => x.id));
  const inSug = new Set(rawSug.map((x) => x.id));

  await store.hdel(K_MEMBERS_H, name);
  await fixLegacyMembers(store, name, null);

  const nN = await dropList(store, K_NOTES_L, K_NOTES_X,
    notes.filter((n) => n.to === name || n.by === name), inNotes);
  const nS = await dropList(store, K_SUG_L, K_SUG_X,
    sug.pending.filter((x) => x.to === name || x.by === name), inSug);

  const nT = await fixStamps(store, name, null);
  const nB = await fixBlind(store, name, null);

  const ad = await store.hgetall(K_SUG_A);
  let nA = 0;
  for (const owner of Object.keys(ad)) {
    const v = ad[owner] || {};
    if (owner === name) { await store.hdel(K_SUG_A, owner); nA++; }
    else if (v.by === name) { await store.hdel(K_SUG_A, owner); nA++; }   // 추천인이 사라졌으니 내립니다
  }
  return { ok: true, 지운_카드: name,
    지운_메모: nN, 지운_추천: nS, 정리한_도장_칸: nT, 지운_블라인드: nB, 내린_열한번째: nA };
}
