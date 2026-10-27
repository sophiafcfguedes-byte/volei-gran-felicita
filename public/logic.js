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
  const SETTINGS_VERSION = 6;
  const ADMIN_ONLY = new Set([
    'bulkAdd', 'savePlayer', 'deletePlayer', 'togglePaid', 'toggleFixed', 'togglePriv', 'settings', 'schedule',
    'setPin', 'bulkPins', 'genPins', 'lockNow', 'unlock', 'unban', 'resetFreq', 'resetPaid', 'deleteSuggestion'
  ]);
  const GAME_ACTIONS = new Set(['join', 'leave', 'addGuest', 'draw', 'role', 'resetPresences']);

  const WED = { day: 3, start: '19:00', end: '22:00', openDay: 2, openTime: '12:00', max: 15, teams: 2, private: true, fixed: false, guests: false };
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

  const emptyGame = meta => ({ meta, presences: [], out: [], roles: {}, teams: null, log: [] });

  /* Uma "visão" de um jogo no formato que as regras usam. Os arrays são os do jogo. */
  function view(s, id) {
    const g = s.games[id];
    if (!g) return null;
    return {
      settings: Object.assign({}, s.settings, { max: g.meta.max, teams: g.meta.teams }),
      players: s.players, current: g.meta,
      presences: g.presences, out: g.out, roles: g.roles, teams: g.teams, log: g.log, frozen: g.frozen || null
    };
  }
  function writeBack(s, id, v) {
    const g = s.games[id];
    g.presences = v.presences; g.out = v.out; g.roles = v.roles; g.teams = v.teams; g.log = v.log; g.frozen = v.frozen || null;
  }

  /* Ajusta estados antigos, fecha jogos que já acabaram (+1 na frequência
     de quem estava confirmado) e abre a lista dos próximos. */
  function normalize(s, now) {
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
    s.settings.v = SETTINGS_VERSION;
    const today = (() => { const p = spParts(now); return isoDate(p.y, p.m, p.d); })();
    s.bans = (s.bans || []).filter(b => b.game >= today);
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
      if (!g.frozen && now >= meta.cutoffAt) g.frozen = derive(view(s, meta.id)).confirmed.slice();
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
    d.confirmed.forEach(pid => { if (pm[pid]) pm[pid].freq = (pm[pid].freq || 0) + 1; });
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
    const k = Math.max(2, Math.min(Math.floor(n / 2), Number(v.settings.teams) || 4));
    const cap = Math.ceil(n / k);
    const P = shuffle(ids.map(id => {
      const p = pm[id], r = v.roles[id] || {};
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
    const spread = () => { const vals = T.map(t => t.sum); return Math.max(...vals) - Math.min(...vals); };
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

  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const randomLetter = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
  const randomPin = () => String(Math.floor(Math.random() * 1000)).padStart(3, '0') + randomLetter();
  const normPin = v => String(v || '').replace(/\s+/g, '').toUpperCase();
  const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
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
    const limit = Number(s.settings.guestLimit) || 0;

    if (ADMIN_ONLY.has(a.type) && !admin) return fail('Só quem é admin pode fazer isso.');
    if (!ADMIN_ONLY.has(a.type) && !me && !admin && a.type !== 'suggest' && a.type !== 'register' && a.type !== 'loginPlayer') return fail('Escolha quem você é antes (no topo da lista).');

    /* ---------- ações de um jogo ---------- */
    if (GAME_ACTIONS.has(a.type)) {
      const v = view(s, a.game);
      if (!v) return fail('Esse jogo não está mais aberto. Recarregue a página.');
      const meta = v.current;
      if (meta.private && !admin && !canSee(meta, me)) return fail('Esse jogo é só pra quem foi liberado.');
      const r = gameAction(s, v, a, { now, admin, me, limit, pm, rand: ctx.rand });
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
        if (a.gender !== 'F' && a.gender !== 'M') return fail('Escolha seu gênero.');
        if (s.players.filter(x => !x.guest).length >= 300) return fail('O grupo chegou no limite de cadastros. Fale com um admin.');
        let p = s.players.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (p && !p.guest) return fail(`Já tem alguém chamado ${p.name}. Procure na lista, ou use um sobrenome.`);
        if (p) { p.guest = false; p.gender = a.gender; }
        else { p = { id: newId(s, 'p'), name, gender: a.gender, skill: 3, paid: false, guest: false, fixed: false, priv: false, photo: null, freq: 0 }; s.players.push(p); }
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
        if (a.gender !== 'F' && a.gender !== 'M') return fail('Escolha o gênero de quem está na lista.');
        const lines = String(a.text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 200);
        if (!lines.length) return fail('Cole pelo menos um nome.');
        let added = 0, skipped = 0;
        for (const line of lines) {
          const m = line.replace(/^[-•*\d.)\s]+(?=\D)/, '').match(/^(.*?)(?:\s+([1-5]))?$/);
          const name = cleanName(m ? m[1] : line);
          if (name.length < 2) continue;
          if (s.players.some(x => x.name.toLowerCase() === name.toLowerCase())) { skipped++; continue; }
          s.players.push({ id: newId(s, 'p'), name, gender: a.gender, skill: m && m[2] ? Number(m[2]) : 3, paid: false, guest: false, fixed: false, priv: !!a.priv, photo: null, freq: 0 });
          added++;
        }
        return { ok: true, added, skipped };
      }
      case 'savePlayer': {
        const name = cleanName(a.name);
        if (name.length < 2) return fail('Escreva o nome.');
        if (a.gender !== 'F' && a.gender !== 'M') return fail('Escolha o gênero.');
        const dup = s.players.find(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== a.id);
        if (dup) return fail(`Já existe alguém chamado ${dup.name}.`);
        let p = a.id ? pm[a.id] : null;
        if (!p) { p = { id: newId(s, 'p'), photo: null, freq: 0, fixed: false, priv: false }; s.players.push(p); }
        Object.assign(p, { name, gender: a.gender, skill: clampSkill(a.skill), paid: !!a.paid, guest: !!a.guest });
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
    const log = (act, pid) => { v.log.unshift({ ts: now, by: me ? me.id : null, act, pid: pid || null }); if (v.log.length > 300) v.log.length = 300; };
    const addedByMe = () => v.presences.filter(x => x.by === a.by && x.pid !== a.by && pm[x.pid] && pm[x.pid].guest).length;
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
        if (p && isFixedHere(p)) {
          if (!admin && a.pid !== a.by) return fail('Só a própria pessoa ou um admin mexe na vaga da comissão.');
          if (!v.out.includes(p.id)) v.out.push(p.id);
          delete v.roles[a.pid]; log('remove', p.id); return ok;
        }
        const pres = v.presences.find(x => x.pid === a.pid);
        if (!pres) return ok;
        if (!admin && a.pid !== a.by && !(p && p.guest && pres.by === a.by)) return fail(p && p.guest ? 'Só quem trouxe o convidado pode tirar.' : 'Cada um só desmarca o próprio nome.');
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
        if (name.split(' ').filter(w => w.length >= 2).length < 2) return fail('Coloque nome e sobrenome do convidado.');
        if (a.gender !== 'F' && a.gender !== 'M') return fail('Escolha o gênero do convidado.');
        if (!admin && addedByMe() >= limit) return fail(limitMsg);
        if (me && fold(name) === fold(me.name)) return fail('Esse é o seu nome. Se o convidado for outra pessoa, coloque o sobrenome dele.');
        let p = s.players.find(x => fold(x.name) === fold(name));
        if (p && !p.guest) return fail(`Já tem ${p.name} no grupo. Se o convidado for outra pessoa, coloque o sobrenome dele.`);
        if (!p) {
          p = { id: newId(s, 'c'), name, gender: a.gender, skill: admin && a.skill ? clampSkill(a.skill) : 3, paid: false, guest: true, fixed: false, priv: false, photo: null, freq: 0 };
          s.players.push(p);
          v.players = s.players;
        }
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
        d.confirmed.forEach(pid => { if (pm[pid]) pm[pid].freq = (pm[pid].freq || 0) + 1; });
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
  function publicState(s, isAdmin, meId) {
    if (isAdmin) return Object.assign({}, s);
    const me = s.players.find(p => p.id === meId);
    const priv = !!(me && me.priv && !me.guest);
    const games = {};
    for (const [id, g] of Object.entries(s.games)) if (!g.meta.private || priv) games[id] = g;
    const players = s.players.map(p => { const q = Object.assign({}, p); q.hasPin = !!p.pin; delete q.skill; delete q.pin; delete q.fails; delete q.lockUntil; return q; });
    const settings = Object.assign({}, s.settings, { schedule: (s.settings.schedule || []).filter(g => !g.private || priv) });
    const bans = (s.bans || []).filter(b => !b.private || priv);
    return Object.assign({}, s, { players, games, settings, bans, suggestions: [] });
  }

  /* Texto das listas abertas (só jogos públicos) — para o robô do WhatsApp. */
  function resumo(s) {
    const pm = playerMap(s), out = [];
    const nm = id => pm[id].name + (pm[id].guest ? ' (C)' : '');
    for (const g of Object.values(s.games).sort((a, b) => a.meta.startAt - b.meta.startAt)) {
      if (g.meta.private) continue;
      const d = derive(view(s, g.meta.id));
      out.push(`🏐 ${gameTitle(g.meta)} (${gameWhen(g.meta)}) — ${d.confirmed.length}/${g.meta.max}`,
        ...d.fixed.map(id => `⭐ ${nm(id)}`), ...d.regular.map((id, i) => `${i + 1}. ${nm(id)}`));
      if (d.waitlist.length) out.push('Espera:', ...d.waitlist.map((id, i) => `${i + 1}. ${nm(id)}`));
      out.push('');
    }
    return out.join('\n').trim();
  }

  return { normPin, nextInSeries, resumo, DAYS, DAYS_SHORT, MONTHS, initialState, normalize, activeGames, view, gameTitle, gameWhen, derive, apply, lockInfo, drawTeams, publicState, ADMIN_ONLY };
});
