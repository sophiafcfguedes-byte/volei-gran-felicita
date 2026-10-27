/* Regras do app Vôlei Gran Felicitá — usado pelo servidor (Netlify/Node) e pelo navegador (modo demo). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoleiLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const DAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const SETTINGS_VERSION = 2;
  const ADMIN_ONLY = new Set([
    'savePlayer', 'deletePlayer', 'togglePaid', 'toggleFixed', 'settings', 'schedule', 'lockNow', 'unlock',
    'resetPresences', 'resetFreq', 'resetPaid', 'deleteSuggestion'
  ]);

  function defaultSettings() {
    return {
      v: SETTINGS_VERSION,
      groupName: 'Vôlei Gran Felicitá',
      max: 24, perTeam: 6, guestLimit: 3, paidPriority: false,
      schedule: [
        { day: 1, start: '19:00', end: '22:00', openDay: 0, openTime: '12:00' },
        { day: 4, start: '19:00', end: '22:00', openDay: 3, openTime: '12:00' }
      ],
      manualLockUntil: 0
    };
  }

  function initialState() {
    return {
      settings: defaultSettings(), current: null,
      players: [], presences: [], out: [], roles: {}, teams: null, log: [], suggestions: [], history: [], seq: 1
    };
  }

  function newId(s, prefix) {
    s.seq = (s.seq || 1) + 1;
    return (prefix || 'p') + s.seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- Datas no horário de Brasília (UTC−3, sem horário de verão) ---------- */
  const SP = -3 * 3600e3;
  const toMins = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const spParts = ts => { const d = new Date(ts + SP); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() }; };
  const spTs = (y, m, d, hhmm) => Date.UTC(y, m, d, 0, toMins(hhmm)) - SP;
  const isoDate = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

  /* O próximo jogo que ainda não terminou, com o horário em que o check-in abre. */
  function activeGame(s, now) {
    const sched = (s.settings.schedule || []).filter(g => g && g.day >= 0 && g.day <= 6);
    const t = spParts(now);
    let best = null;
    for (let k = 0; k <= 7; k++) {
      const base = new Date(Date.UTC(t.y, t.m, t.d + k));
      const y = base.getUTCFullYear(), m = base.getUTCMonth(), d = base.getUTCDate(), wd = base.getUTCDay();
      for (const g of sched) {
        if (g.day !== wd) continue;
        const startAt = spTs(y, m, d, g.start), endAt = spTs(y, m, d, g.end);
        if (endAt <= now) continue;
        const before = ((g.day - g.openDay) % 7 + 7) % 7;
        const openAt = spTs(y, m, d - before, g.openTime);
        const cand = { id: isoDate(y, m, d), day: wd, start: g.start, end: g.end, startAt, endAt, openAt, openDay: g.openDay, openTime: g.openTime };
        if (!best || cand.startAt < best.startAt) best = cand;
      }
      if (best) break;
    }
    return best;
  }

  function gameTitle(g) { return g ? `Vôlei de ${DAYS[g.day].toLowerCase()}` : 'Sem jogo marcado'; }
  function gameWhen(g) {
    if (!g) return '';
    const p = spParts(g.startAt);
    return `${DAYS_SHORT[g.day]}, ${p.d} de ${MONTHS[p.m]} · ${g.start}–${g.end}`;
  }

  /* Ajusta estados antigos e vira o jogo quando o anterior já acabou.
     Quem estava confirmado no jogo que acabou ganha +1 na frequência. */
  function normalize(s, now) {
    const init = initialState();
    for (const k of Object.keys(init)) if (s[k] === undefined) s[k] = init[k];
    if (!s.settings || s.settings.v !== SETTINGS_VERSION) {
      const old = s.settings || {};
      s.settings = Object.assign(defaultSettings(), { groupName: old.groupName || 'Vôlei Gran Felicitá', perTeam: old.perTeam || 6, guestLimit: old.guestLimit != null ? old.guestLimit : 3 });
    }
    const g = activeGame(s, now);
    const id = g ? g.id : null;
    if (!s.current || s.current.id !== id) {
      if (s.current && (s.presences.length || s.players.some(p => p.fixed))) finishGame(s);
      s.presences = []; s.out = []; s.roles = {}; s.teams = null; s.log = [];
    }
    s.current = g;
    return s;
  }

  function finishGame(s) {
    const d = derive(s);
    const pm = playerMap(s);
    d.confirmed.forEach(id => { if (pm[id]) pm[id].freq = (pm[id].freq || 0) + 1; });
    s.history.unshift({ id: s.current ? s.current.id : null, confirmed: d.confirmed });
    if (s.history.length > 60) s.history.length = 60;
  }

  function lockInfo(s, now) {
    const st = s.settings, g = s.current;
    if (!g) return { locked: true, reason: 'noGame' };
    if (st.manualLockUntil && st.manualLockUntil > now) return { locked: true, reason: 'manual', until: st.manualLockUntil };
    if (now < g.openAt) return { locked: true, reason: 'notOpen', opensAt: g.openAt };
    return { locked: false };
  }

  const playerMap = s => Object.fromEntries(s.players.map(p => [p.id, p]));

  /* Comissão (vaga garantida) entra primeiro; o resto por ordem de check-in
     (ou quem pagou a vaquinha primeiro, se essa opção estiver ligada). */
  function derive(s) {
    const pm = playerMap(s);
    const outSet = new Set(s.out || []);
    const fixed = s.players.filter(p => p.fixed && !outSet.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(p => p.id);
    const prio = !!s.settings.paidPriority;
    const ordered = s.presences.filter(x => pm[x.pid] && !pm[x.pid].fixed).slice()
      .sort((a, b) => (prio ? (pm[b.pid].paid ? 1 : 0) - (pm[a.pid].paid ? 1 : 0) : 0) || a.ts - b.ts);
    const max = Number(s.settings.max) || 24;
    const open = Math.max(0, max - fixed.length);
    return {
      fixed, ordered, open,
      regular: ordered.slice(0, open).map(x => x.pid),
      confirmed: fixed.concat(ordered.slice(0, open).map(x => x.pid)),
      waitlist: ordered.slice(open).map(x => x.pid)
    };
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  /* Times equilibrados: espalha levantadores, depois mulheres, depois homens,
     sempre no time com menos daquele tipo e menor soma de nível; depois troca
     pares do mesmo perfil entre times enquanto a diferença de nível cair. */
  function drawTeams(s, ids, rand) {
    rand = rand || Math.random;
    const pm = playerMap(s);
    const n = ids.length;
    const per = Number(s.settings.perTeam) || 6;
    const k = Math.max(2, Math.min(Math.floor(n / 2), Math.round(n / per)));
    const cap = Math.ceil(n / k);
    const P = shuffle(ids.map(id => {
      const p = pm[id], r = s.roles[id] || {};
      return { id, g: p.gender === 'F' ? 'F' : 'M', sk: Number(p.skill) || 3, st: !!r.setter };
    }), rand);
    const bySkill = arr => arr.sort((a, b) => b.sk - a.sk);
    const order = [
      ...bySkill(P.filter(x => x.st)),
      ...bySkill(P.filter(x => !x.st && x.g === 'F')),
      ...bySkill(P.filter(x => !x.st && x.g === 'M'))
    ];
    const T = Array.from({ length: k }, () => ({ m: [], sum: 0, st: 0, f: 0 }));
    for (const x of order) {
      const open = T.filter(t => t.m.length < cap);
      const key = t => [x.st ? t.st : x.g === 'F' ? t.f : 0, t.sum, t.m.length];
      open.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return rand() - 0.5; });
      const t = open[0];
      t.m.push(x); t.sum += x.sk; if (x.st) t.st++; if (x.g === 'F') t.f++;
    }
    const spread = () => { const v = T.map(t => t.sum); return Math.max(...v) - Math.min(...v); };
    for (let it = 0; it < 600; it++) {
      const a = T[Math.floor(rand() * k)], b = T[Math.floor(rand() * k)];
      if (a === b || !a.m.length || !b.m.length) continue;
      const i = Math.floor(rand() * a.m.length), x = a.m[i];
      const j = b.m.findIndex(y => y.g === x.g && y.st === x.st && y.sk !== x.sk);
      if (j < 0) continue;
      const y = b.m[j], before = spread();
      a.sum += y.sk - x.sk; b.sum += x.sk - y.sk;
      if (spread() < before) { a.m[i] = y; b.m[j] = x; } else { a.sum -= y.sk - x.sk; b.sum -= x.sk - y.sk; }
    }
    return T.map(t => t.m.map(x => x.id));
  }

  const cleanName = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const clampSkill = v => Math.min(5, Math.max(1, Math.round(Number(v) || 3)));
  const cleanTime = v => /^\d{2}:\d{2}$/.test(String(v)) ? String(v) : null;

  function apply(s, a, ctx) {
    const now = ctx.now, admin = !!ctx.isAdmin;
    normalize(s, now);
    const fail = error => ({ ok: false, error });
    const ok = { ok: true };
    const pm = playerMap(s);
    const me = a.by ? pm[a.by] : null;
    const lk = lockInfo(s, now);
    const lockMsg = lk.reason === 'notOpen' ? 'O check-in ainda não abriu.' : lk.reason === 'noGame' ? 'Não tem jogo marcado.' : 'A lista está fechada agora.';
    const locked = lk.locked && !admin;
    const log = (act, pid) => {
      s.log.unshift({ ts: now, by: me ? me.id : null, act, pid: pid || null });
      if (s.log.length > 300) s.log.length = 300;
    };
    const addedByMe = () => s.presences.filter(x => x.by === a.by && x.pid !== a.by).length;
    const limit = Number(s.settings.guestLimit) || 0;

    if (ADMIN_ONLY.has(a.type) && !admin) return fail('Só quem é admin pode fazer isso.');
    if (!ADMIN_ONLY.has(a.type) && !me && !admin && a.type !== 'suggest') return fail('Escolha quem você é antes (no topo da lista).');

    switch (a.type) {
      case 'join': {
        const p = pm[a.pid];
        if (!p) return fail('Jogador não encontrado.');
        if (p.fixed) {
          if (!admin && a.pid !== a.by) return fail('Só a própria pessoa ou um admin mexe na vaga da comissão.');
          s.out = (s.out || []).filter(id => id !== p.id); log('add', p.id); return ok;
        }
        if (locked) return fail(lockMsg);
        if (s.presences.some(x => x.pid === p.id)) return ok;
        if (!admin && p.id !== a.by && addedByMe() >= limit) return fail(limit ? `Você já marcou ${limit} pessoa${limit > 1 ? 's' : ''} além de você. Esse é o limite.` : 'Cada um só pode marcar a si mesmo.');
        s.presences.push({ pid: p.id, by: me ? me.id : null, ts: now });
        log('add', p.id);
        return ok;
      }
      case 'leave': {
        const p = pm[a.pid];
        if (p && p.fixed) {
          if (!admin && a.pid !== a.by) return fail('Só a própria pessoa ou um admin mexe na vaga da comissão.');
          if (!s.out.includes(p.id)) s.out.push(p.id);
          delete s.roles[a.pid]; log('remove', p.id); return ok;
        }
        if (locked && lk.reason !== 'notOpen') return fail(lockMsg);
        const before = s.presences.length;
        s.presences = s.presences.filter(x => x.pid !== a.pid);
        if (s.presences.length === before) return ok;
        delete s.roles[a.pid];
        log('remove', a.pid);
        return ok;
      }
      case 'addGuest': {
        if (locked) return fail(lockMsg);
        const name = cleanName(a.name);
        if (name.length < 2) return fail('Escreva o nome do convidado.');
        if (a.gender !== 'F' && a.gender !== 'M') return fail('Escolha o gênero do convidado.');
        if (!admin && addedByMe() >= limit) return fail(limit ? `Você já marcou ${limit} pessoa${limit > 1 ? 's' : ''} além de você. Esse é o limite.` : 'Cada um só pode marcar a si mesmo.');
        let p = s.players.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (p && !p.guest) return fail(`${p.name} já está no grupo. Marque na lista.`);
        if (!p) {
          p = { id: newId(s, 'c'), name, gender: a.gender, skill: clampSkill(a.skill), paid: false, guest: true, fixed: false, photo: null, freq: 0 };
          s.players.push(p);
        }
        if (s.presences.some(x => x.pid === p.id)) return fail(`${p.name} já está na lista.`);
        s.presences.push({ pid: p.id, by: me ? me.id : null, ts: now });
        log('add', p.id);
        return ok;
      }
      case 'role': {
        if (!['setter', 'late'].includes(a.role) || !pm[a.pid]) return fail('Ação inválida.');
        const r = s.roles[a.pid] || {};
        r[a.role] = !r[a.role];
        s.roles[a.pid] = r;
        return ok;
      }
      case 'draw': {
        const d = derive(s);
        if (d.confirmed.length < 4) return fail('Precisa de pelo menos 4 confirmados pra sortear.');
        s.teams = { ts: now, by: me ? me.id : null, list: drawTeams(s, d.confirmed, ctx.rand) };
        log('draw');
        return ok;
      }
      case 'photo': {
        if (!admin && a.pid !== a.by) return fail('Você só pode trocar a sua própria foto.');
        const p = pm[a.pid];
        if (!p) return fail('Jogador não encontrado.');
        if (a.photo !== null && !(typeof a.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(a.photo) && a.photo.length < 150000))
          return fail('Foto inválida ou grande demais.');
        p.photo = a.photo;
        return ok;
      }
      case 'suggest': {
        const text = String(a.text || '').trim().slice(0, 1000);
        if (text.length < 3) return fail('Escreva sua sugestão.');
        s.suggestions.unshift({ id: newId(s, 's'), ts: now, text, by: a.anon || !me ? null : me.id });
        if (s.suggestions.length > 200) s.suggestions.length = 200;
        return ok;
      }

      /* ---------- admin ---------- */
      case 'savePlayer': {
        const name = cleanName(a.name);
        if (name.length < 2) return fail('Escreva o nome.');
        if (a.gender !== 'F' && a.gender !== 'M') return fail('Escolha o gênero.');
        const dup = s.players.find(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== a.id);
        if (dup) return fail(`Já existe alguém chamado ${dup.name}.`);
        let p = a.id ? pm[a.id] : null;
        if (!p) { p = { id: newId(s, 'p'), photo: null, freq: 0, fixed: false }; s.players.push(p); }
        Object.assign(p, { name, gender: a.gender, skill: clampSkill(a.skill), paid: !!a.paid, guest: !!a.guest });
        if (a.fixed !== undefined) p.fixed = !!a.fixed && !p.guest;
        return ok;
      }
      case 'deletePlayer': {
        s.players = s.players.filter(x => x.id !== a.id);
        s.presences = s.presences.filter(x => x.pid !== a.id);
        s.out = s.out.filter(id => id !== a.id);
        delete s.roles[a.id];
        if (s.teams) s.teams.list = s.teams.list.map(t => t.filter(id => id !== a.id));
        return ok;
      }
      case 'togglePaid': { const p = pm[a.id]; if (p) p.paid = !p.paid; return ok; }
      case 'toggleFixed': {
        const p = pm[a.id];
        if (!p || p.guest) return fail('Convidado não pode ter vaga garantida.');
        p.fixed = !p.fixed;
        if (p.fixed) s.presences = s.presences.filter(x => x.pid !== p.id);
        else s.out = s.out.filter(id => id !== p.id);
        return ok;
      }
      case 'settings': {
        const st = s.settings;
        if (a.groupName !== undefined) st.groupName = cleanName(a.groupName) || 'Vôlei Gran Felicitá';
        if (a.max !== undefined) st.max = Math.min(60, Math.max(4, Math.round(Number(a.max) || 24)));
        if (a.perTeam !== undefined) st.perTeam = Math.min(9, Math.max(2, Math.round(Number(a.perTeam) || 6)));
        if (a.guestLimit !== undefined) st.guestLimit = Math.min(10, Math.max(0, Math.round(Number(a.guestLimit) || 0)));
        if (a.paidPriority !== undefined) st.paidPriority = !!a.paidPriority;
        return ok;
      }
      case 'schedule': {
        if (!Array.isArray(a.schedule) || a.schedule.length > 7) return fail('Horários inválidos.');
        const list = [];
        for (const g of a.schedule) {
          const day = Number(g.day), openDay = Number(g.openDay);
          const start = cleanTime(g.start), end = cleanTime(g.end), openTime = cleanTime(g.openTime);
          if (!(day >= 0 && day <= 6 && openDay >= 0 && openDay <= 6) || !start || !end || !openTime) return fail('Preencha dia e horários de todos os jogos.');
          if (toMins(end) <= toMins(start)) return fail('O horário de fim precisa ser depois do início.');
          if (list.some(x => x.day === day)) return fail(`Tem dois jogos na ${DAYS[day].toLowerCase()}.`);
          list.push({ day, start, end, openDay, openTime });
        }
        s.settings.schedule = list.sort((x, y) => x.day - y.day);
        s.current = activeGame(s, now);
        return ok;
      }
      case 'lockNow': {
        const m = Math.min(60 * 24 * 7, Math.max(1, Math.round(Number(a.minutes) || 0)));
        s.settings.manualLockUntil = now + m * 60000;
        return ok;
      }
      case 'unlock': s.settings.manualLockUntil = 0; return ok;
      case 'resetPresences': {
        finishGame(s);
        s.presences = []; s.out = []; s.roles = {}; s.teams = null; s.log = [];
        return ok;
      }
      case 'resetFreq': s.players.forEach(p => { p.freq = 0; }); return ok;
      case 'resetPaid': s.players.forEach(p => { p.paid = false; }); return ok;
      case 'deleteSuggestion': s.suggestions = s.suggestions.filter(x => x.id !== a.id); return ok;
    }
    return fail('Ação desconhecida.');
  }

  /* O que todo mundo pode ver (sugestões só para admin). */
  function publicState(s, isAdmin) {
    return Object.assign({}, s, { suggestions: isAdmin ? s.suggestions : [] });
  }

  return { DAYS, DAYS_SHORT, MONTHS, initialState, normalize, activeGame, gameTitle, gameWhen, derive, apply, lockInfo, drawTeams, publicState, ADMIN_ONLY };
});
