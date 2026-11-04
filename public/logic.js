/* Regras do app Vôlei Gran Felicitá — usado pelo servidor (Netlify/Node) e pelo navegador (modo demo).
   Cada dia de jogo configurado tem a sua própria lista. Jogos "fechados" só aparecem
   para quem tem a bolinha (player.priv). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoleiLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const DAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const SETTINGS_VERSION = 8;
  const ADMIN_ONLY = new Set([
    'bulkAdd', 'savePlayer', 'deletePlayer', 'togglePaid', 'toggleFixed', 'togglePriv', 'settings', 'schedule',
    'pagAprovar', 'pagRecusar', 'toggleCaixinha', 'vaquinhaAte', 'caixaAdd', 'caixaDel', 'caixaSaldo', 'punir', 'draw', 'role', 'toggleMorador', 'toggleCadastrado', 'acessoNow', 'setPin', 'bulkPins', 'genPins', 'lockNow', 'unlock', 'unban', 'resetFreq', 'resetPaid', 'deleteSuggestion'
  ]);
  const GAME_ACTIONS = new Set(['join', 'leave', 'addGuest', 'draw', 'role', 'resetPresences']);

  const WED = { day: 3, start: '19:40', end: '21:00', openDay: 2, openTime: '12:00', max: 15, teams: 2, private: true, fixed: false, guests: false };
  function defaultSettings() {
    return {
      v: SETTINGS_VERSION,
      groupName: 'Vôlei Gran Felicitá',
      guestLimit: 3, paidPriority: false,
      schedule: [
        { day: 1, start: '19:00', end: '22:00', openDay: 0, openTime: '12:00', max: 24, teams: 4, private: false, fixed: true, guests: true },
        Object.assign({}, WED),
        { day: 4, start: '19:00', end: '22:00', openDay: 3, openTime: '12:00', max: 24, teams: 4, private: false, fixed: true, guests: true }
      ],
      manualLockUntil: 0
    };
  }

  function initialState() {
    return { settings: defaultSettings(), players: [], games: {}, bans: [], suggestions: [], history: [], seq: 1 };
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

  /* A próxima data de cada dia de jogo que ainda não terminou. */
  function activeGames(s, now) {
    const t = spParts(now), out = [];
    for (const g of s.settings.schedule || []) {
      for (let k = 0; k <= 7; k++) {
        const base = new Date(Date.UTC(t.y, t.m, t.d + k));
        const y = base.getUTCFullYear(), m = base.getUTCMonth(), d = base.getUTCDate();
        if (base.getUTCDay() !== g.day) continue;
        const startAt = spTs(y, m, d, g.start), endAt = spTs(y, m, d, g.end);
        if (endAt <= now) continue;
        const before = ((g.day - g.openDay) % 7 + 7) % 7;
        out.push({
          id: isoDate(y, m, d), day: g.day, start: g.start, end: g.end, startAt, endAt,
          openAt: spTs(y, m, d - before, g.openTime), openDay: g.openDay, openTime: g.openTime,
          cutoff: g.cutoff || '17:00', cutoffAt: spTs(y, m, d, g.cutoff || '17:00'),
          max: Number(g.max) || 24, teams: Number(g.teams) || 4, private: !!g.private, fixed: g.fixed !== false, guests: g.guests !== undefined ? !!g.guests : !g.private
        });
        break;
      }
    }
    return out.sort((a, b) => a.startAt - b.startAt);
  }

  function gameTitle(g) { return g ? `Vôlei de ${DAYS[g.day].toLowerCase()}` : 'Sem jogo marcado'; }
  function gameWhen(g) {
    if (!g) return '';
    const p = spParts(g.startAt);
    return `${DAYS_SHORT[g.day]}, ${p.d} de ${MONTHS[p.m]} · ${g.start}–${g.end}`;
  }

  const emptyGame = meta => ({ meta, presences: [], out: [], roles: {}, teams: null, log: [], promos: [] });

  /* Uma "visão" de um jogo no formato que as regras usam. Os arrays são os do jogo. */
  function view(s, id) {
    const g = s.games[id];
    if (!g) return null;
    return {
      settings: Object.assign({}, s.settings, { max: g.meta.max, teams: g.meta.teams }),
      players: s.players, current: g.meta,
      presences: g.presences, out: g.out, roles: g.roles, teams: g.teams, log: g.log, frozen: g.frozen || null, promos: g.promos || []
    };
  }
  function writeBack(s, id, v) {
    const g = s.games[id];
    g.presences = v.presences; g.out = v.out; g.roles = v.roles; g.teams = v.teams; g.log = v.log; g.frozen = v.frozen || null; g.promos = v.promos || [];
  }

  /* Ajusta estados antigos, fecha jogos que já acabaram (+1 na frequência
     de quem estava confirmado) e abre a lista dos próximos. */
  function normalize(s, now) {
    if (s.settings) s.settings.paidPriority = false; // vaquinha desligada
    const init = initialState();
    for (const k of Object.keys(init)) if (s[k] === undefined) s[k] = init[k];
    const st = s.settings || {};
    if (!st.v || st.v < 3) {
      const fresh = defaultSettings();
      if (Array.isArray(st.schedule) && st.schedule.length) {
        fresh.schedule = st.schedule.map(g => Object.assign({ max: Number(st.max) || 24, teams: Number(st.teams) || 4, private: false, fixed: true }, g));
        if (!fresh.schedule.some(g => g.day === 3)) fresh.schedule.push(Object.assign({}, WED));
        fresh.schedule.sort((a, b) => a.day - b.day);
      }
      fresh.groupName = st.groupName || fresh.groupName;
      if (st.guestLimit != null) fresh.guestLimit = st.guestLimit;
      fresh.paidPriority = !!st.paidPriority;
      s.settings = fresh;
      if (s.current && s.current.id) {
        const meta = Object.assign({ max: Number(st.max) || 24, teams: Number(st.teams) || 4, private: false, fixed: true }, s.current);
        s.games[s.current.id] = { meta, presences: s.presences || [], out: s.out || [], roles: s.roles || {}, teams: s.teams || null, log: s.log || [] };
      }
      ['current', 'presences', 'out', 'roles', 'teams', 'log'].forEach(k => delete s[k]);
    }
    if (s.settings.v === 3) {
      /* v4: quarta passa a ter 2 times (8 e 7). */
      s.settings.schedule.forEach(g => { if (g.day === 3 && g.private && Number(g.teams) === 3) g.teams = 2; });
      for (const g of Object.values(s.games)) if (g.meta && g.meta.day === 3 && g.meta.private && g.meta.teams === 3) g.meta.teams = 2;
    }
    if (s.settings.v < 5) {
      /* v5: convidado só nos jogos abertos (segunda e quinta). */
      s.settings.schedule.forEach(g => { if (g.guests === undefined) g.guests = !g.private; });
    }
    if (s.settings.v < 6) s.settings.schedule.forEach(g => { if (!g.cutoff) g.cutoff = '17:00'; });
    if (s.settings.v < 7) {
      /* v7: níveis de 1–5 para 1–8 (Iniciante N1 … Muito bom N2). */
      const map = { 1: 1, 2: 2, 3: 3, 4: 5, 5: 7 };
      s.players.forEach(p => { if (p.skill) p.skill = map[p.skill] || 3; });
    }
    if (s.settings.v < 8) {
      /* v8: nível vira nota de 0 a 5, de meio em meio (0 = iniciante, 5 = muito bom). */
      const map = { 1: 0, 2: 0.5, 3: 1.5, 4: 2, 5: 3, 6: 3.5, 7: 4.5, 8: 5 };
      s.players.forEach(p => { if (p.skill != null) p.skill = map[p.skill] != null ? map[p.skill] : 2.5; });
    }
    s.settings.v = SETTINGS_VERSION;
    const today = (() => { const p = spParts(now); return isoDate(p.y, p.m, p.d); })();
    /* Suspensão acaba às 17h (horário-limite) do jogo em que a pessoa estava impedida: aí já pode marcar o próximo. */
    s.bans = (s.bans || []).filter(b => b.game > today || (b.game === today && !(s.games[b.game] && now >= s.games[b.game].meta.cutoffAt)));
    const act = activeGames(s, now);
    const ids = new Set(act.map(g => g.id));
    for (const id of Object.keys(s.games)) {
      if (ids.has(id)) continue;
      const g = s.games[id];
      if (g.meta && now >= g.meta.endAt) finishGame(s, id);
      delete s.games[id];
    }
    for (const meta of act) {
      if (!s.games[meta.id]) s.games[meta.id] = emptyGame(meta);
      else s.games[meta.id].meta = meta;
      /* No horário-limite (17h do dia do jogo) a lista fecha com quem está confirmado. */
      const g = s.games[meta.id];
      if (!g.frozen && now >= meta.cutoffAt) {
        g.frozen = derive(view(s, meta.id)).confirmed.slice();
        /* Às 17h, com a lista fechada, os times são sorteados sozinhos. */
        const v = view(s, meta.id), conf = derive(v).confirmed;
        if (conf.length >= 4) g.teams = { ts: meta.cutoffAt, by: null, auto: true, list: drawTeams(v, conf) };
      }
    }
    /* Convidado não fica no cadastro: some quando não está em nenhuma lista aberta. */
    const used = new Set();
    for (const g of Object.values(s.games)) g.presences.forEach(x => used.add(x.pid));
    s.players = s.players.filter(p => !p.guest || used.has(p.id));
    return s;
  }

  function finishGame(s, id) {
    const v = view(s, id);
    if (!v) return;
    const d = derive(v);
    const pm = playerMap(s);
    /* Frequência conta só os jogos abertos (segunda e quinta); jogo fechado (quarta) não soma. */
    if (!v.current.private) d.confirmed.forEach(pid => { if (pm[pid]) pm[pid].freq = (pm[pid].freq || 0) + 1; });
    s.history.unshift({ id, confirmed: d.confirmed });
    if (s.history.length > 90) s.history.length = 90;
  }

  function lockInfo(v, now) {
    const g = v && v.current;
    if (!g) return { locked: true, reason: 'noGame' };
    if (v.settings.manualLockUntil && v.settings.manualLockUntil > now) return { locked: true, reason: 'manual', until: v.settings.manualLockUntil };
    if (now < g.openAt) return { locked: true, reason: 'notOpen', opensAt: g.openAt };
    if (g.cutoffAt && now >= g.cutoffAt) return { locked: true, reason: 'closed', at: g.cutoffAt };
    return { locked: false };
  }

  const playerMap = s => Object.fromEntries(s.players.map(p => [p.id, p]));
  const canSee = (meta, p) => !meta.private || !!(p && p.priv);

  /* Comissão (vaga garantida, se o jogo tiver) entra primeiro; o resto por ordem de
     check-in (ou quem pagou a vaquinha primeiro, se essa opção estiver ligada). */
  function derive(v) {
    if (!v || !v.current) return { fixed: [], ordered: [], open: 0, regular: [], confirmed: [], waitlist: [] };
    const meta = v.current, pm = playerMap(v);
    const outSet = new Set(v.out || []);
    const isFixedHere = p => meta.fixed && p.fixed && canSee(meta, p);
    const fixed = v.players.filter(p => isFixedHere(p) && !outSet.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(p => p.id);
    const prio = !!v.settings.paidPriority;
    const ordered = v.presences.filter(x => pm[x.pid] && !isFixedHere(pm[x.pid])).slice()
      .sort((a, b) => (prio ? (pm[b.pid].paid ? 1 : 0) - (pm[a.pid].paid ? 1 : 0) : 0) || a.ts - b.ts);
    const open = Math.max(0, (Number(meta.max) || 24) - fixed.length);
    if (v.frozen) {
      /* Lista fechada: só joga quem estava confirmado no horário-limite; a espera não sobe mais. */
      const fz = new Set(v.frozen), present = new Set(v.presences.map(x => x.pid));
      const fixedF = fixed.filter(id => fz.has(id));
      const regular = v.frozen.filter(id => pm[id] && !isFixedHere(pm[id]) && present.has(id));
      return { fixed: fixedF, ordered, open, frozen: true, regular, confirmed: fixedF.concat(regular), waitlist: ordered.filter(x => !fz.has(x.pid)).map(x => x.pid) };
    }
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

  /* Times equilibrados: espalha mulheres e homens pelo nível, sempre no time com
     menos daquele tipo e menor soma; depois troca pares do mesmo gênero enquanto
     a diferença de nível entre os times cair. */
  function drawTeams(v, ids, rand) {
    rand = rand || Math.random;
    const pm = playerMap(v);
    const n = ids.length;
    const k = !(v.meta && v.meta.private) ? (Number(v.settings.teams) || 4) : Math.max(2, Math.min(Math.floor(n / 2), Number(v.settings.teams) || 4));
    /* Segunda/quinta: times de 6 obrigatórios (o último fica com o que sobrar). Quarta: divide igual. */
    const six = !(v.meta && v.meta.private);
    const capOf = i => six ? Math.min(6, Math.max(0, n - 6 * i)) : Math.ceil(n / k);
    const P = shuffle(ids.map(id => {
      const p = pm[id], r = v.roles[id] || {};
      const sk0 = p.skill != null && p.skill !== '' ? Number(p.skill) : 2.5;
      /* Gênero só pesa entre os Muito bom (N1/N2); nos outros níveis tanto faz homem ou mulher. */
      return { id, g: 'X', /* gênero não conta no sorteio */ sk: sk0, st: !!r.setter, ag: Number(p.age) || 0 };
    }), rand);
    const bySkill = arr => arr.sort((a, b) => b.sk - a.sk);
    const order = [
      ...bySkill(P.filter(x => x.st)),
      ...bySkill(P.filter(x => !x.st && x.g === 'F')),
      ...bySkill(P.filter(x => !x.st && x.g === 'M')),
      ...bySkill(P.filter(x => !x.st && x.g === 'X'))
    ];
    const T = Array.from({ length: k }, (_, i) => ({ cap: capOf(i), m: [], sum: 0, st: 0, f: 0, mm: 0, ages: [0, 0, 0, 0, 0] })).filter(t => t.cap > 0);
    const put = (t, x) => { t.m.push(x); t.ages[x.ag]++; t.sum += x.sk; if (x.st) t.st++; if (x.g === 'F') t.f++; if (x.g === 'M') t.mm++; };
    /* Segunda/quinta, do jeito da comissão (por camadas): ordena por nota e reparte em camadas de 4
       (os 4 melhores, os 4 seguintes...), um de cada camada por time, em "cobrinha": quem pega o
       melhor da 1ª camada pega o pior da 2ª, e assim por diante. Assim o time do nota 5 fica com o
       nota 0, cada time leva um da faixa do 4, um da faixa do 3... Depois troca gente da MESMA camada
       entre times só se deixar as somas mais parecidas. */
    if (!(v.meta && v.meta.private)) {
      const sorted = shuffle(order.slice(), rand).sort((a, b) => b.sk - a.sk);
      const teams = shuffle(T.slice(), rand).sort((a, b) => b.cap - a.cap);
      let fwd = true, layer = 0;
      for (let i = 0; i < sorted.length; layer++, fwd = !fwd) {
        const seq = fwd ? teams : teams.slice().reverse();
        for (const t of seq) { if (i >= sorted.length) break; if (t.m.length >= t.cap) continue; const x = sorted[i++]; x.lock = 'L' + layer; put(t, x); }
      }
      const spreadS = () => { const v2 = T.map(t => t.sum / t.cap); return Math.max(...v2) - Math.min(...v2); };
      for (let it = 0; it < 800; it++) {
        const a = T[Math.floor(rand() * T.length)], b = T[Math.floor(rand() * T.length)];
        if (a === b) continue;
        const ia = Math.floor(rand() * a.m.length), x = a.m[ia];
        const ib = b.m.findIndex(y => y.lock === x.lock && y.sk !== x.sk);
        if (ib < 0) continue;
        const y = b.m[ib], before = spreadS();
        a.sum += y.sk - x.sk; b.sum += x.sk - y.sk;
        if (spreadS() < before - 1e-9) { a.m[ia] = y; b.m[ib] = x; } else { a.sum -= y.sk - x.sk; b.sum -= x.sk - y.sk; }
      }
    }
    for (const x of order) {
      if (x.lock) continue;
      const open = T.filter(t => t.m.length < t.cap);
      /* gênero primeiro, depois faixa etária espalhada, depois nível */
      const key = t => [x.st ? t.st : x.g === 'F' ? t.f : x.g === 'M' ? t.mm : 0, x.ag ? t.ages[x.ag] : 0, t.sum / t.cap, t.m.length];
      open.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return rand() - 0.5; });
      put(open[0], x);
    }
    const spread = () => { const vals = T.map(t => t.sum / t.cap); return Math.max(...vals) - Math.min(...vals); };
    for (let it = 0; it < 600; it++) {
      const a = T[Math.floor(rand() * T.length)], b = T[Math.floor(rand() * T.length)];
      if (a === b || !a.m.length || !b.m.length) continue;
      const i = Math.floor(rand() * a.m.length), x = a.m[i];
      /* Troca só entre "iguais": iniciante com iniciante, muito bom com muito bom (do mesmo gênero), o resto entre si. */
      const cat = z => z.sk >= 4.5 ? 'mb' : z.sk <= 1 ? 'in' : 'md';
      if (x.lock) continue; /* os pares (melhor + mais fraco) e os nota 4/3 ficam onde foram colocados */
      const j = b.m.findIndex(y => !y.lock && cat(y) === cat(x) && y.ag === x.ag && y.g === x.g && y.st === x.st && y.sk !== x.sk);
      if (j < 0) continue;
      const y = b.m[j], before = spread();
      a.sum += y.sk - x.sk; b.sum += x.sk - y.sk;
      if (spread() < before) { a.m[i] = y; b.m[j] = x; } else { a.sum -= y.sk - x.sk; b.sum -= x.sk - y.sk; }
    }
    return T.map(t => t.m.map(x => x.id));
  }

  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const randomLetter = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
  /* Caixinha: mês no formato AAAA-MM (horário de Brasília). */
  const monthKey = ts => { const p = spParts(ts); return p.y + '-' + String(p.m + 1).padStart(2, '0'); };
  /* Quem precisa pagar a vaquinha: a partir de VAQUINHA_DESDE; moradores, comissão e quem tem vaquinha marcada não pagam. */
  const VAQUINHA_DESDE = '2026-11-04';
  /* Vaquinha ligada = liberado (pagou adiantado); com "desliga em" (AAAA-MM), a liberação acaba no começo daquele mês. */
  const liberadoVaquinha = (p, mk) => !!p.caixinha && (!p.caixinhaAte || (mk || monthKey(Date.now())) < p.caixinhaAte);
  const pagaVaquinha = (p, mk) => !!p && !p.guest && !p.morador && !p.fixed && !liberadoVaquinha(p, mk);
  const devePagarVaquinha = (p, meta) => !!meta && pagaVaquinha(p, monthKey(meta.startAt)) && meta.id >= VAQUINHA_DESDE;
  /* Convidado pagou no mês: pelo nome ou pelo CPF (o CPF fica guardado na primeira vez que ele entra). */
  const pagouConvidado = (s, name, mk, cpf) => {
    const m = (s.pagGuests || {})[mk] || {};
    const e = m[fold(name)] && m[fold(name)].st === 'ok' ? m[fold(name)] : cpf ? Object.values(m).find(x => x.st === 'ok' && x.cpf === cpf) : null;
    if (e && cpf && !e.cpf) e.cpf = cpf;
    return !!e;
  };
  const pagou = (s, pid, mk) => !!(s.pag && s.pag[mk] && s.pag[mk][pid] && s.pag[mk][pid].st === 'ok');
  const cpfOk = d => {
    if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
    const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = s * 10 % 11; return r === 10 ? 0 : r; };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  };
  const randomPin = () => String(Math.floor(Math.random() * 1000)).padStart(3, '0') + randomLetter();
  const normPin = v => String(v || '').replace(/\s+/g, '').toUpperCase();
  const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const cleanName = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const clampSkill = v => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && String(v) !== '' ? Math.min(5, Math.max(0, Math.round(n * 2) / 2)) : 2.5; };
  const cleanTime = v => /^\d{2}:\d{2}$/.test(String(v)) ? String(v) : null;

  function apply(s, a, ctx) {
    const now = ctx.now, admin = !!ctx.isAdmin;
    normalize(s, now);
    const fail = error => ({ ok: false, error });
    const ok = { ok: true };
    const pm = playerMap(s);
    const me = a.by ? pm[a.by] : null;
    const limit = Number(s.settings.guestLimit) || 0;

    if (ADMIN_ONLY.has(a.type) && !admin) return fail('Só quem é admin pode fazer isso.');
    if (!ADMIN_ONLY.has(a.type) && !me && !admin && a.type !== 'suggest' && a.type !== 'register' && a.type !== 'loginPlayer') return fail('Escolha quem você é antes (no topo da lista).');

    /* ---------- ações de um jogo ---------- */
    if (GAME_ACTIONS.has(a.type)) {
      const v = view(s, a.game);
      if (!v) return fail('Esse jogo não está mais aberto. Recarregue a página.');
      const meta = v.current;
      if (meta.private && !admin && !canSee(meta, me)) return fail('Esse jogo é só pra quem foi liberado.');
      const before = derive(v).confirmed;
      const r = gameAction(s, v, a, { now, admin, me, limit, pm, rand: ctx.rand });
      /* Quem saiu da espera e entrou na lista: o robô avisa no grupo. */
      if (r.ok && a.type === 'leave') {
        /* again: já tinha subido antes neste jogo — o robô atualiza a lista sem marcar de novo. */
        const up = derive(v).confirmed.filter(id => !before.includes(id) && id !== a.pid );
        v.promos = (v.promos || []).concat(up.map(pid => {
          const pr = v.presences.find(x => x.pid === pid) || {};
          return { pid, ts: now, by: pr.by && pr.by !== pid ? pr.by : null, again: (v.promos || []).some(x => x.pid === pid) };
        })).slice(-60);
      }
      writeBack(s, a.game, v);
      return r;
    }

    switch (a.type) {
      case 'loginPlayer': {
        const p = pm[a.pid];
        if (!p || p.guest) return fail('Escolha seu nome na lista.');
        if (!p.pin) return fail('Você ainda não tem senha. Peça pra comissão.');
        if (p.lockUntil && p.lockUntil > now) return fail(`Muitas tentativas erradas. Tente de novo depois das ${new Date(p.lockUntil + SP).toISOString().slice(11, 16)}.`);
        if (normPin(a.pin) !== normPin(p.pin)) {
          p.fails = (p.fails || 0) + 1;
          if (p.fails >= 5) { p.lockUntil = now + 15 * 60000; p.fails = 0; return fail('Senha errada 5 vezes. Espere 15 minutos.'); }
          return fail(`Senha errada. Tentativa ${p.fails} de 5.`);
        }
        p.fails = 0; p.lockUntil = 0;
        return { ok: true, pid: p.id };
      }
      case 'setPin': {
        const p = pm[a.id];
        if (!p || p.guest) return fail('Jogador não encontrado.');
        const pin = a.pin === 'random' ? randomPin() : normPin(a.pin);
        if (!/^[0-9A-Z]{3,8}$/.test(pin)) return fail('A senha precisa ter de 3 a 8 letras ou números.');
        p.pin = pin; p.fails = 0; p.lockUntil = 0;
        return { ok: true, pin };
      }
      case 'genPins': {
        let n = 0;
        s.players.forEach(p => { if (!p.guest && !p.pin) { p.pin = randomPin(); n++; } });
        return { ok: true, added: n };
      }
      case 'bulkPins': {
        /* Uma linha por pessoa: "Nome 123" (o app sorteia a letra) ou "Nome 123K". */
        const lines = String(a.text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 300);
        if (!lines.length) return fail('Cole pelo menos uma linha.');
        const byName = {};
        s.players.forEach(p => { if (!p.guest) byName[fold(p.name)] = p; });
        let done = 0; const missing = [];
        for (const line of lines) {
          const m = line.match(/^(.*?)[\s;,\t]+(\d{3})([a-zA-Z]?)$/);
          if (!m) { missing.push(line); continue; }
          const p = byName[fold(m[1])];
          if (!p) { missing.push(cleanName(m[1])); continue; }
          p.pin = m[2] + (m[3] ? m[3].toUpperCase() : randomLetter()); p.fails = 0; p.lockUntil = 0; done++;
        }
        return { ok: true, added: done, missing };
      }
      case 'register': {
        if (!admin) return fail('Pra entrar no grupo, fale com a comissão.');
        const name = cleanName(a.name);
        if (name.length < 2) return fail('Escreva seu nome.');
        if (s.players.filter(x => !x.guest).length >= 300) return fail('O grupo chegou no limite de cadastros. Fale com um admin.');
        let p = s.players.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (p && !p.guest) return fail(`Já tem alguém chamado ${p.name}. Procure na lista, ou use um sobrenome.`);
        if (p) { p.guest = false; p.gender = a.gender; }
        else { p = { id: newId(s, 'p'), name, gender: a.gender, skill: 2.5, paid: false, guest: false, fixed: false, priv: false, photo: null, freq: 0 }; s.players.push(p); }
        return { ok: true, id: p.id };
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
      case 'bulkAdd': {
        const lines = String(a.text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 200);
        if (!lines.length) return fail('Cole pelo menos um nome.');
        let added = 0, skipped = 0;
        for (const line of lines) {
          const m = line.replace(/^[-•*\d.)\s]+(?=\D)/, '').match(/^(.*?)(?:\s+([0-5](?:[.,]5)?))?$/);
          const name = cleanName(m ? m[1] : line);
          if (name.length < 2) continue;
          if (s.players.some(x => x.name.toLowerCase() === name.toLowerCase())) { skipped++; continue; }
          s.players.push({ id: newId(s, 'p'), name, gender: a.gender, skill: m && m[2] ? clampSkill(m[2]) : 2.5, paid: false, guest: false, fixed: false, priv: !!a.priv, photo: null, freq: 0 });
          added++;
        }
        return { ok: true, added, skipped };
      }
      case 'savePlayer': {
        const name = cleanName(a.name);
        if (name.length < 2) return fail('Escreva o nome.');
        const dup = s.players.find(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== a.id);
        if (dup) return fail(`Já existe alguém chamado ${dup.name}.`);
        let p = a.id ? pm[a.id] : null;
        if (!p) { p = { id: newId(s, 'p'), photo: null, freq: 0, fixed: false, priv: false }; s.players.push(p); }
        Object.assign(p, { name, gender: a.gender || p.gender || '', skill: clampSkill(a.skill), paid: !!a.paid, guest: !!a.guest });
        if (a.age !== undefined) p.age = Math.max(0, Math.min(4, Math.round(Number(a.age) || 0)));
        if (a.fixed !== undefined) p.fixed = !!a.fixed && !p.guest;
        if (a.priv !== undefined) p.priv = !!a.priv && !p.guest;
        return ok;
      }
      case 'deletePlayer': {
        s.players = s.players.filter(x => x.id !== a.id);
        for (const g of Object.values(s.games)) {
          g.presences = g.presences.filter(x => x.pid !== a.id);
          g.out = g.out.filter(id => id !== a.id);
          delete g.roles[a.id];
          if (g.teams) g.teams.list = g.teams.list.map(t => t.filter(id => id !== a.id));
        }
        return ok;
      }
      case 'setPhone': {
        const p = pm[a.id];
        if (!p || p.guest) return fail('Jogador não encontrado.');
        if (!admin && a.id !== a.by) return fail('Cada um só cadastra o próprio celular.');
        const d = String(a.phone || '').replace(/\D/g, '');
        if (d && (d.length < 10 || d.length > 13)) return fail('Celular inválido. Use DDD + número, ex.: 11 98765-4321.');
        p.phone = d ? (d.length <= 11 ? '55' + d : d) : '';
        return ok;
      }
      case 'setCpf': {
        /* CPF e nome completo pra liberar a entrada no condomínio (portaria). Só a pessoa e os admins veem. */
        const p = pm[a.id];
        if (!p || p.guest) return fail('Jogador não encontrado.');
        if (!admin && a.id !== a.by) return fail('Cada um só cadastra o próprio CPF.');
        const d = String(a.cpf || '').replace(/\D/g, '');
        if (d && !cpfOk(d)) return fail('CPF inválido. Confira os números.');
        const full = cleanName(a.fullName || '');
        if (d && full.split(' ').filter(w => w.length >= 2).length < 2) return fail('Escreva seu nome completo (nome e sobrenome).');
        p.cpf = d; p.fullName = d ? full : '';
        return ok;
      }
      case 'toggleMorador': { const p = pm[a.id]; if (p && !p.guest) { p.morador = !p.morador; if (p.morador) p.cadastrado = false; } return ok; }
      case 'toggleCadastrado': { const p = pm[a.id]; if (p && !p.guest) { p.cadastrado = !p.cadastrado; if (p.cadastrado) p.morador = false; } return ok; }
      case 'acessoNow': { s.acessoReq = { game: a.game, ts: now }; return ok; }
      case 'togglePaid': { const p = pm[a.id]; if (p) p.paid = !p.paid; return ok; }
      case 'toggleFixed': {
        const p = pm[a.id];
        if (!p || p.guest) return fail('Convidado não pode ter vaga garantida.');
        p.fixed = !p.fixed;
        for (const g of Object.values(s.games)) {
          if (p.fixed && g.meta.fixed) g.presences = g.presences.filter(x => x.pid !== p.id);
          if (!p.fixed) g.out = g.out.filter(id => id !== p.id);
        }
        return ok;
      }
      case 'togglePriv': {
        const p = pm[a.id];
        if (!p || p.guest) return fail('Convidado não precisa da bolinha: quem trouxe já tem acesso.');
        p.priv = !p.priv;
        if (!p.priv) for (const g of Object.values(s.games)) if (g.meta.private) g.presences = g.presences.filter(x => x.pid !== p.id);
        return ok;
      }
      case 'settings': {
        const st = s.settings;
        if (a.groupName !== undefined) st.groupName = cleanName(a.groupName) || 'Vôlei Gran Felicitá';
        if (a.guestLimit !== undefined) st.guestLimit = Math.min(10, Math.max(0, Math.round(Number(a.guestLimit) || 0)));
        if (a.paidPriority !== undefined) st.paidPriority = !!a.paidPriority;
        if (a.moradores !== undefined) st.moradores = String(a.moradores).slice(0, 8000);
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
          list.push({
            day, start, end, openDay, openTime,
            max: Math.min(60, Math.max(4, Math.round(Number(g.max) || 24))),
            teams: Math.min(8, Math.max(2, Math.round(Number(g.teams) || 4))),
            private: !!g.private, fixed: !!g.fixed, guests: !!g.guests, cutoff: cleanTime(g.cutoff) || '17:00'
          });
        }
        s.settings.schedule = list.sort((x, y) => x.day - y.day);
        normalize(s, now);
        return ok;
      }
      case 'lockNow': {
        const m = Math.min(60 * 24 * 7, Math.max(1, Math.round(Number(a.minutes) || 0)));
        s.settings.manualLockUntil = now + m * 60000;
        return ok;
      }
      case 'unlock': s.settings.manualLockUntil = 0; return ok;
      case 'pagAprovar': case 'pagRecusar': {
        const mk = a.month || monthKey(now);
        s.pag ||= {}; s.pag[mk] ||= {};
        const cur = s.pag[mk][a.pid] || { ts: now };
        s.pag[mk][a.pid] = Object.assign(cur, a.type === 'pagAprovar' ? { st: 'ok', why: '' } : { st: 'recusado', why: String(a.why || 'Comprovante recusado pela comissão.').slice(0, 200) });
        return ok;
      }
      case 'vaquinhaAte': { const p = pm[a.id]; if (p && !p.guest) p.caixinhaAte = /^\d{4}-\d{2}$/.test(a.month || '') ? a.month : ''; return ok; }
      case 'caixaAdd': {
        const desc = String(a.desc || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const raw = String(a.valor || '').replace(/[^\d,.]/g, ''); const v = Math.round(Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw) * 100) / 100;
        if (desc.length < 2) return fail('Escreva com o que foi.');
        if (!(v > 0)) return fail('Valor inválido.');
        s.caixa ||= {}; s.caixa.lanc ||= [];
        s.caixa.lanc.unshift({ id: newId(s, 'x'), ts: now, desc, valor: a.tipo === 'entrada' ? v : -v });
        return ok;
      }
      case 'caixaSaldo': {
        const raw = String(a.valor || '').replace(/[^\d,.]/g, ''); const v = Math.round(Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw) * 100) / 100;
        if (!Number.isFinite(v) || raw === '') return fail('Valor inválido.');
        s.caixa ||= {}; s.caixa.base = { valor: v, ts: now };
        return ok;
      }
      case 'caixaDel': { if (s.caixa && s.caixa.lanc) s.caixa.lanc = s.caixa.lanc.filter(x => x.id !== a.id); return ok; }
      case 'toggleCaixinha': { const p = pm[a.id]; if (p && !p.guest) p.caixinha = !p.caixinha; return ok; } /* marcado = liberado (já pagou adiantado) */
      case 'punir': {
        /* Impedido de jogar o próximo jogo (segunda/quinta) por falta. */
        const p = s.players.find(x => !x.guest && fold(x.name) === fold(a.name));
        if (!p) return fail('Não achei ninguém com esse nome.');
        /* Próximo jogo cujo check-in ainda não abriu: nunca tira o nome de quem já está numa lista. */
        const nx = activeGames(s, now).filter(g => !g.private && g.openAt > now)[0];
        if (!nx) return fail('Não achei o próximo jogo.');
        s.bans = (s.bans || []).filter(b => !(b.pid === p.id && b.game === nx.id));
        s.bans.push({ pid: p.id, game: nx.id, nextDay: nx.day, reason: 'falta', private: false, ts: now });
        return ok;
      }
      case 'unban': s.bans = s.bans.filter(b => !(b.pid === a.pid && b.game === a.game)); return ok;
      case 'resetFreq': s.players.forEach(p => { p.freq = 0; }); return ok;
      case 'resetPaid': s.players.forEach(p => { p.paid = false; }); return ok;
      case 'deleteSuggestion': s.suggestions = s.suggestions.filter(x => x.id !== a.id); return ok;
    }
    return fail('Ação desconhecida.');
  }

  function gameAction(s, v, a, c) {
    const { now, admin, me, limit, pm } = c;
    const fail = error => ({ ok: false, error });
    const ok = { ok: true };
    const meta = v.current;
    const lk = lockInfo(v, now);
    const lockMsg = lk.reason === 'notOpen' ? 'O check-in ainda não abriu.' : lk.reason === 'closed' ? `A lista fechou às ${meta.cutoff}.` : 'A lista está fechada agora.';
    const locked = lk.locked && !admin;
    const log = (act, pid) => { const q = pid && pm[pid]; v.log.unshift({ ts: now, by: me ? me.id : null, act, pid: pid || null, name: q ? q.name : null, byName: me ? me.name : null }); if (v.log.length > 300) v.log.length = 300; };
    const addedByMe = () => v.presences.filter(x => x.by === a.by && x.pid !== a.by && pm[x.pid] && (pm[x.pid].guest || x.asGuest)).length;
    const limitMsg = limit ? `Você já trouxe ${limit} convidado${limit > 1 ? 's' : ''}. Esse é o limite.` : 'Esse grupo não aceita convidados.';
    const isFixedHere = p => meta.fixed && p.fixed && canSee(meta, p);

    switch (a.type) {
      case 'join': {
        const p = pm[a.pid];
        if (!p) return fail('Jogador não encontrado.');
        if (!p.guest && !canSee(meta, p)) return fail(`${p.name} não tem a bolinha desse jogo.`);
        if (p.guest && !meta.guests && !admin) return fail('Esse jogo não aceita convidados.');
        if (isFixedHere(p)) {
          if (!admin && a.pid !== a.by) return fail('Só a própria pessoa ou um admin mexe na vaga da comissão.');
          if (lk.reason === 'closed') return fail(lockMsg);
          v.out = v.out.filter(id => id !== p.id); log('add', p.id); return ok;
        }
        if (!admin && p.id !== a.by && !p.guest) return fail('Cada um só marca o próprio nome.');
        const ban = !admin && (s.bans || []).find(b => b.pid === p.id && b.game === meta.id);
        if (!admin && devePagarVaquinha(p, meta) && !pagou(s, p.id, monthKey(meta.startAt))) return fail('Você não fez o pagamento do mês, anexe seu comprovante para fazer seu check-in.');
        if (ban && ban.reason === 'falta') return fail('Você não compareceu da última vez e foi punida, aguarde o próximo dia de jogo.');
        if (ban) return fail(`Você tirou o nome do vôlei de ${DAYS[ban.fromDay].toLowerCase()} depois das ${ban.cutoff}, então está fora deste jogo.`);
        if (lk.reason === 'closed' || locked) return fail(lockMsg);
        if (v.presences.some(x => x.pid === p.id)) return ok;
        if (!admin && p.id !== a.by && addedByMe() >= limit) return fail(limitMsg);
        v.presences.push({ pid: p.id, by: me ? me.id : null, ts: now });
        log('add', p.id);
        return ok;
      }
      case 'leave': {
        const p = pm[a.pid];
        if (!admin && lk.reason === 'closed') return fail(`A lista já fechou às ${meta.cutoff}. Não dá mais pra desistir pelo app; fale com a comissão.`);
        if (p && isFixedHere(p)) {
          if (!admin && a.pid !== a.by) return fail('Só a própria pessoa ou um admin mexe na vaga da comissão.');
          if (!v.out.includes(p.id)) v.out.push(p.id);
          delete v.roles[a.pid]; log('remove', p.id); return ok;
        }
        const pres = v.presences.find(x => x.pid === a.pid);
        if (!pres) return ok;
        if (!admin && a.pid !== a.by && !(p && (p.guest || pres.asGuest) && pres.by === a.by)) return fail(p && (p.guest || pres.asGuest) ? 'Só quem trouxe o convidado pode tirar.' : 'Cada um só desmarca o próprio nome.');
        if (locked && lk.reason !== 'notOpen' && lk.reason !== 'closed') return fail(lockMsg);
        const wasConfirmed = derive(v).confirmed.includes(a.pid);
        v.presences = v.presences.filter(x => x.pid !== a.pid);
        delete v.roles[a.pid];
        log('remove', a.pid);
        /* Desistência no dia do jogo depois do horário-limite: fica fora do próximo jogo da mesma sequência. */
        if (!admin && p && !p.guest && a.pid === a.by && wasConfirmed && now >= meta.cutoffAt && now < meta.endAt) {
          const nx = nextInSeries(s, meta);
          if (nx) {
            s.bans = (s.bans || []).filter(b => !(b.pid === p.id && b.game === nx.id));
            s.bans.push({ pid: p.id, game: nx.id, nextDay: nx.day, from: meta.id, fromDay: meta.day, cutoff: meta.cutoff, private: !!meta.private, ts: now });
            const g2 = s.games[nx.id];
            if (g2) g2.presences = g2.presences.filter(x => x.pid !== p.id);
            return { ok: true, banned: nx.id, bannedDay: nx.day };
          }
        }
        return ok;
      }
      case 'addGuest': {
        if (!meta.guests && !admin) return fail('Esse jogo não aceita convidados.');
        if (lk.reason === 'closed' || locked) return fail(lockMsg);
        const name = cleanName(a.name);
        if (name.length < 2) return fail('Escreva o nome do convidado.');
        if (!admin && addedByMe() >= limit) return fail(limitMsg);
        if (me && fold(name) === fold(me.name)) return fail('Esse é o seu nome. Se o convidado for outra pessoa, coloque o sobrenome dele.');
        let p = s.players.find(x => fold(x.name) === fold(name));
        if (p && !p.guest) {
          /* Já tem cadastro: entra como convidado de quem trouxe, com o nível do cadastro (não cria outro). */
          if (!canSee(meta, p)) return fail(`${p.name} não tem a bolinha desse jogo.`);
          if (isFixedHere(p)) return fail(`${p.name} é da comissão e já tem vaga garantida.`);
          if (v.presences.some(x => x.pid === p.id)) return fail(`${p.name} já está na lista.`);
          const b = (s.bans || []).find(x => x.pid === p.id && x.game === meta.id);
          if (b && !admin) return fail(b.reason === 'falta' ? `${p.name} está impedido(a) neste jogo por falta.` : `${p.name} está fora deste jogo por ter desistido depois das ${b.cutoff}.`);
          /* Já tem cadastro: precisa estar em dia com a vaquinha (comprovante dele, vaquinha ligada ou pago como convidado). */
          if (!admin && devePagarVaquinha(p, meta) && !pagou(s, p.id, monthKey(meta.startAt)) && !pagouConvidado(s, p.name, monthKey(meta.startAt), p.cpf || ''))
            return fail(`${p.name} ainda não pagou a vaquinha deste mês. Ele(a) precisa anexar o comprovante no app (ou pague como convidado com o comprovante no nome dele).`);
          v.presences.push({ pid: p.id, by: me ? me.id : null, ts: now, asGuest: true });
          log('add', p.id);
          return ok;
        }
        if (!p && name.split(' ').filter(w => w.length >= 2).length < 2) return fail('Coloque nome e sobrenome do convidado.');
        if (!admin && meta.id >= '2026-11-01' && !pagouConvidado(s, name, monthKey(meta.startAt), String(a.cpf || '').replace(/\D/g, ''))) return fail('Anexe o comprovante da vaquinha do convidado (R$ 5,00, com o nome dele e a data deste mês).');
        const gcpf = String(a.cpf || '').replace(/\D/g, '');
        if (!gcpf && !(p && p.guest && p.cpf) && !(me && me.morador)) return fail('Coloque o CPF do convidado (é pra liberar a entrada na portaria).');
        if (gcpf && !cpfOk(gcpf)) return fail('CPF do convidado inválido. Confira os números.');
        if (!p) {
          p = { id: newId(s, 'c'), name, gender: a.gender, skill: clampSkill(a.skill), paid: false, guest: true, fixed: false, priv: false, photo: null, freq: 0, cpf: gcpf, fullName: gcpf ? name : '' };
          s.players.push(p);
          v.players = s.players;
        }
        if (p.guest && gcpf) { p.cpf = gcpf; p.fullName = p.name; }
        if (v.presences.some(x => x.pid === p.id)) return fail(`${p.name} já está na lista.`);
        v.presences.push({ pid: p.id, by: me ? me.id : null, ts: now });
        log('add', p.id);
        return ok;
      }
      case 'role': {
        if (!['setter', 'late'].includes(a.role) || !pm[a.pid]) return fail('Ação inválida.');
        const r = v.roles[a.pid] || {};
        r[a.role] = !r[a.role];
        v.roles[a.pid] = r;
        return ok;
      }
      case 'draw': {
        const d = derive(v);
        if (d.confirmed.length < 4) return fail('Precisa de pelo menos 4 confirmados pra sortear.');
        v.teams = { ts: now, by: me ? me.id : null, list: drawTeams(v, d.confirmed, c.rand) };
        log('draw');
        return ok;
      }
      case 'resetPresences': {
        if (!admin) return fail('Só quem é admin pode fazer isso.');
        const d = derive(v);
        if (!meta.private) d.confirmed.forEach(pid => { if (pm[pid]) pm[pid].freq = (pm[pid].freq || 0) + 1; });
        s.history.unshift({ id: meta.id, confirmed: d.confirmed });
        v.presences = []; v.out = []; v.roles = {}; v.teams = null; v.log = [];
        return ok;
      }
    }
    return fail('Ação desconhecida.');
  }

  /* O próximo jogo da mesma sequência (segunda/quinta juntas; jogos fechados juntos). */
  function nextInSeries(s, meta) {
    const after = activeGames(s, meta.endAt + 1).filter(g => g.private === !!meta.private && g.startAt > meta.startAt);
    return after[0] || null;
  }

  /* O que cada pessoa recebe: sem nível (só admin), sem sugestões (só admin) e sem
     os jogos fechados para quem não tem a bolinha. */
  /* Reservas da quadra (Vida de Síndico) com o apartamento trocado pelo nome. */
  function parseMoradores(text) {
    const map = {};
    for (const line of String(text || '').split(/\n/)) {
      const m = line.replace(/^\s*\d+\s*[-–.)]\s*/, '').match(/^(.+?)\s+(?:b|t|torre|bloco)\s*0*(\d+)\s*[-/ ]\s*(\d+)\s*$/i);
      if (m) map[m[2] + '-' + m[3]] = m[1].trim();
    }
    return map;
  }
  /* Próximos 30 dias: segunda e quinta (e quarta pra quem é da bolinha), horários das 19h às 21h. */
  function agenda(s, now, withWed) {
    now = now || Date.now();
    const r = s.reservas;
    if (!r) return null;
    const map = parseMoradores(s.settings.moradores);
    const toTs = iso => Date.parse(iso + '-03:00');
    const evs = (r.list || []).map(e => {
      const u = e.title.match(/torre\s*0*(\d+)\s*-\s*(\w+)/i);
      const key = u ? u[1] + '-' + u[2] : null;
      const blocked = /interdit/i.test(e.title);
      return { start: toTs(e.start), end: toTs(e.end), who: blocked ? 'Interditado' : key && map[key] ? map[key] : u ? `Torre ${u[1].padStart(2, '0')} - ${u[2]}` : e.title, blocked, pending: /pendente|aguard/i.test(e.title) };
    });
    const today = spParts(now), days = [];
    for (let i = 0; i < 30; i++) {
      const q = spParts(Date.UTC(today.y, today.m, today.d + i, 12) - SP);
      if (!(q.wd === 1 || q.wd === 4 || (withWed && q.wd === 3))) continue;
      const slots = [19, 20].map(h => {
        const a = spTs(q.y, q.m, q.d, h + ':00'), b = a + 3600e3;
        const hit = evs.filter(e => e.start < b && e.end > a).sort((x, y) => x.blocked - y.blocked)[0];
        return { start: a, end: b, who: hit ? hit.who : null, blocked: !!(hit && hit.blocked), pending: !!(hit && hit.pending) };
      });
      const left = slots.filter(x => x.end > now); /* horário que já passou some da tela */
      if (left.length) days.push({ date: spTs(q.y, q.m, q.d, '00:00'), wd: q.wd, slots: left });
    }
    return { ts: r.ts || null, ok: r.ok !== false, days };
  }

  /* Situação na portaria de cada jogo (sem CPF nem erro detalhado) — todos veem. */
  function portaria(s, games) {
    const pm = playerMap(s), out = {};
    for (const [id, g] of Object.entries(games)) {
      const ran = (s.acessos || {})[id], m = {};
      const ids = new Set([...(g.presences || []).map(x => x.pid), ...derive(view(s, id)).confirmed]);
      for (const pid of ids) {
        const pr = (g.presences || []).find(x => x.pid === pid) || { pid };
        const p = pm[pr.pid]; if (!p) continue;
        const it = ran && ran.items.find(x => x.pid === pr.pid);
        /* Cadastro atual manda: morador/cadastrado mudados depois das 17h aparecem na hora. */
        const now = p.morador ? 'morador' : p.cadastrado ? 'cadastrado' : p.cpf ? 'pronto' : (p.guest && pm[pr.by] && pm[pr.by].morador) ? 'convmorador' : 'semcpf';
        m[pr.pid] = it && (it.st === 'criada' || it.st === 'ja' || it.st === 'erro') && now === 'pronto' ? it.st : now;
      }
      out[id] = { ts: ran ? ran.ts : null, st: m };
    }
    return out;
  }

  /* Caixinha: saldo inicial + R$ 5 por comprovante aprovado (a partir de 1º/11/2026) + entradas − gastos lançados pelos admins. */
  const CAIXA_INICIAL = 65.07, CAIXA_DESDE = Date.parse('2026-11-01T19:55:00-03:00'), VALOR_VAQUINHA = 5;
  function caixaView(s) {
    /* Admin pode acertar o saldo: a partir daí só soma o que vier depois. */
    const base = (s.caixa && s.caixa.base) || { valor: CAIXA_INICIAL, ts: CAIXA_DESDE };
    let n = 0, tot = 0;
    for (const m of [s.pag, s.pagGuests]) for (const mes of Object.values(m || {})) for (const e of Object.values(mes)) if (e && e.st === 'ok' && (e.ts || 0) >= base.ts) { n++; tot += e.valor >= VALOR_VAQUINHA ? e.valor : VALOR_VAQUINHA; } /* soma o valor do comprovante (mínimo R$ 5) */
    const lanc = ((s.caixa || {}).lanc || []).map(x => ({ id: x.id, ts: x.ts, desc: x.desc, valor: x.valor }));
    const soma = lanc.filter(x => x.ts >= base.ts).reduce((t, x) => t + x.valor, 0);
    return { inicial: base.valor, comprovantes: n, entradaVaquinha: Math.round(tot * 100) / 100, lanc, saldo: Math.round((base.valor + tot + soma) * 100) / 100 };
  }

  function publicState(s, isAdmin, meId) {
    if (isAdmin) return Object.assign({}, s, { caixaV: caixaView(s), portaria: portaria(s, s.games), agenda: agenda(s, 0, true), reservas: undefined, reservasErr: s.reservas && !s.reservas.ok ? s.reservas.err : null });
    const me = s.players.find(p => p.id === meId);
    const priv = !!(me && me.priv && !me.guest);
    const games = {};
    for (const [id, g] of Object.entries(s.games)) if (!g.meta.private || priv) games[id] = g;
    const players = s.players.map(p => { const q = Object.assign({}, p); q.hasPin = !!p.pin; delete q.skill; delete q.age; delete q.pin; if (p.id !== meId) { delete q.phone; delete q.cpf; delete q.fullName; } if (p.id !== meId) { delete q.morador; delete q.cadastrado; delete q.caixinha; delete q.caixinhaAte; } delete q.fails; delete q.lockUntil; return q; });
    const settings = Object.assign({}, s.settings, { schedule: (s.settings.schedule || []).filter(g => !g.private || priv) });
    const bans = (s.bans || []).filter(b => (!b.private || priv) && b.pid === meId); // cada um só recebe a própria suspensão
    delete settings.moradores;
    return Object.assign({}, s, { players, games, settings, bans, pag: (() => { const o = {}; for (const [mk, m] of Object.entries(s.pag || {})) if (m[meId]) o[mk] = { [meId]: { st: m[meId].st, why: m[meId].why || '', ts: m[meId].ts } }; return o; })(), suggestions: [], caixaV: caixaView(s), pagGuests: undefined, caixa: undefined, reservas: undefined, portaria: portaria(s, games), acessos: undefined, acessoReq: undefined, agenda: agenda(s, 0, priv) });
  }

  /* Texto das listas abertas (só jogos públicos) — para o robô do WhatsApp. */
  /* Nome como aparece nas listas: convidado leva quem trouxe entre parênteses — "Maria Bonita (Sophia)". */
  function labelIn(pm, presences, id) {
    const p = pm[id];
    if (!p) return '?';
    const pr = (presences || []).find(x => x.pid === id);
    if ((p.guest || (pr && pr.asGuest)) && pr && pr.by && pm[pr.by]) return `${p.name} (${pm[pr.by].name})`;
    return p.guest ? p.name + ' (C)' : p.name;
  }

  function resumo(s) {
    const pm = playerMap(s), out = [];
    for (const g of Object.values(s.games).sort((a, b) => a.meta.startAt - b.meta.startAt)) {
      if (g.meta.private) continue;
      const nm = id => labelIn(pm, g.presences, id);
      const d = derive(view(s, g.meta.id));
      out.push(`🏐 ${gameTitle(g.meta)} (${gameWhen(g.meta)}) — ${d.confirmed.length}/${g.meta.max}`,
        ...d.fixed.map(id => `⭐ ${nm(id)}`), ...d.regular.map((id, i) => `${i + 1}. ${nm(id)}`));
      if (d.waitlist.length) out.push('Espera:', ...d.waitlist.map((id, i) => `${i + 1}. ${nm(id)}`));
      out.push('');
    }
    return out.join('\n').trim();
  }

  /* Situação de cada jogo para o robô do WhatsApp avisar quando a lista completa
     (jogo fechado → grupo da quarta; os outros → grupo principal). Só para uso interno. */
  /* Nome dos times: segunda/quinta têm cor; quarta fica Time 1, Time 2. */
  const TEAM_COLORS = [['Amarelo', '🟡'], ['Azul', '🔵'], ['Verde', '🟢'], ['Laranja', '🟠']];
  function teamName(meta, i) {
    const c = !meta || meta.private ? null : TEAM_COLORS[i];
    return c ? `${c[1]} Time ${c[0]}` : `Time ${i + 1}`;
  }

  const MIN_QUARTA = 12;
  const quartaCancelada = (v, d) => !!(v && v.current && v.current.private && v.frozen && d.confirmed.length < MIN_QUARTA);
  function avisos(s, now) {
    now = now || Date.now();
    const pm = playerMap(s), out = [];
    for (const g of Object.values(s.games).sort((a, b) => a.meta.startAt - b.meta.startAt)) {
      const nm = id => labelIn(pm, g.presences, id);
      const d = derive(view(s, g.meta.id));
      const p = spParts(g.meta.startAt);
      const dd = String(p.d).padStart(2, '0') + '/' + String(p.m + 1).padStart(2, '0');
      const lines = [`🏐 *VÔLEI DE ${DAYS[g.meta.day].toUpperCase()} (${dd})* 🏐`, `${g.meta.start} às ${g.meta.end}`,
        `✅ Lista completa: ${d.confirmed.length}/${g.meta.max}`, '',
        ...d.fixed.map(id => `⭐ ${nm(id)}`), ...d.regular.map((id, i) => `${i + 1}. ${nm(id)}`)];
      if (d.waitlist.length) lines.push('', '*Lista de espera*', ...d.waitlist.map((id, i) => `${i + 1}. ${nm(id)}`));
      lines.push('', `Quem desistir até as ${g.meta.cutoff} libera a vaga pra espera.`);
      const who = id => pm[id] ? { pid: id, name: pm[id].name, fullName: pm[id].fullName || '', phone: pm[id].phone || '', guest: !!pm[id].guest } : null;
      const promos = (g.promos || []).map(x => ({ key: g.meta.id + ':' + x.pid + ':' + x.ts, ...who(x.pid), by: x.by ? who(x.by) : null, again: !!x.again })).filter(x => x.pid);
      let teams = null;
      if (g.teams && g.teams.auto && g.teams.list.length) {
        const tl = [`🏐 *VÔLEI DE ${DAYS[g.meta.day].toUpperCase()} (${dd})* 🏐`, '*Times sorteados*'];
        g.teams.list.forEach((t, i) => { tl.push('', `*${teamName(g.meta, i)}*`, ...t.filter(id => pm[id]).map(id => '• ' + nm(id))); });
        teams = { key: g.meta.id + ':times:' + g.teams.ts, text: tl.join('\n') };
      }
      /* Segunda/quinta às 13h: se ainda sobrar vaga, chama todo mundo no grupo (uma vez). */
      let vagas = null;
      const t13 = spTs(p.y, p.m, p.d, '13:00'), left = g.meta.max - d.confirmed.length;
      if (!g.meta.private && left > 0 && !g.frozen && now >= t13 && now < g.meta.cutoffAt) {
        vagas = { key: g.meta.id + ':vagas13d', text: `🏐 *VÔLEI DE ${DAYS[g.meta.day].toUpperCase()} (${dd})* 🏐\nFaltam ${left} ${left === 1 ? 'vaga' : 'vagas'} a ${left === 1 ? 'ser preenchida' : 'serem preenchidas'} pro vôlei de hoje (${g.meta.start}).` };
      }
      /* Quarta (jogo fechado): se às 17h não tiver 12 confirmados, o vôlei é cancelado e o robô avisa no grupo. */
      let cancel = null;
      if (g.meta.private && g.frozen && d.confirmed.length < MIN_QUARTA) {
        cancel = { key: g.meta.id + ':cancelado', text: `vôlei cancelado pois não atingiu o número mínimo de pessoas`, title: `🏐 *VÔLEI DE ${DAYS[g.meta.day].toUpperCase()} (${dd})* 🏐` };
        teams = null;
      }
      out.push({ cancel, vagas, teams, promos, id: g.meta.id, group: g.meta.private ? 'quarta' : 'principal', day: g.meta.day, count: d.confirmed.length, max: g.meta.max, full: d.confirmed.length >= g.meta.max, text: lines.join('\n') });
    }
    return { games: out };
  }

  return { quartaCancelada, pagaVaquinha, devePagarVaquinha, monthKey, teamName, labelIn, avisos, normPin, nextInSeries, resumo, DAYS, DAYS_SHORT, MONTHS, initialState, normalize, activeGames, view, gameTitle, gameWhen, derive, apply, lockInfo, drawTeams, publicState, ADMIN_ONLY };
});
