/* Regras do app do vôlei — usado pelo servidor (Node) e pelo navegador (modo demo). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoleiLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const ADMIN_ONLY = new Set([
    'savePlayer', 'deletePlayer', 'togglePaid', 'settings', 'lockNow', 'unlock',
    'autoLock', 'resetPresences', 'resetFreq', 'resetPaid', 'deleteSuggestion'
  ]);

  function initialState() {
    return {
      settings: {
        groupName: 'Vôlei Gran Felicitá', title: 'Jogo da semana', date: '', start: '19:00', end: '22:00',
        max: 18, perTeam: 6, guestLimit: 3,
        autoLock: { enabled: false, day: 5, from: '07:30', to: '12:00' },
        manualLockUntil: 0
      },
      players: [], presences: [], roles: {}, teams: null, log: [], suggestions: [], seq: 1
    };
  }

  function newId(s, prefix) {
    s.seq = (s.seq || 1) + 1;
    return (prefix || 'p') + s.seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  const toMins = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

  function spNow(now) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(now));
    const get = t => (parts.find(p => p.type === t) || {}).value;
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { day, mins: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
  }

  function lockInfo(s, now) {
    const st = s.settings;
    if (st.manualLockUntil && st.manualLockUntil > now) return { locked: true, reason: 'manual', until: st.manualLockUntil };
    const a = st.autoLock;
    if (a && a.enabled) {
      const t = spNow(now);
      if (t.day === Number(a.day) && t.mins >= toMins(a.from) && t.mins < toMins(a.to)) return { locked: true, reason: 'auto' };
    }
    return { locked: false };
  }

  const playerMap = s => Object.fromEntries(s.players.map(p => [p.id, p]));

  /* Quem pagou a vaquinha vem primeiro; depois, por ordem de chegada. */
  function derive(s) {
    const pm = playerMap(s);
    const ordered = s.presences.filter(x => pm[x.pid]).slice()
      .sort((a, b) => (pm[b.pid].paid ? 1 : 0) - (pm[a.pid].paid ? 1 : 0) || a.ts - b.ts);
    const max = Number(s.settings.max) || 18;
    return {
      ordered,
      confirmed: ordered.slice(0, max).map(x => x.pid),
      waitlist: ordered.slice(max).map(x => x.pid)
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

  function apply(s, a, ctx) {
    const now = ctx.now, admin = !!ctx.isAdmin;
    const fail = error => ({ ok: false, error });
    const ok = { ok: true };
    const pm = playerMap(s);
    const me = a.by ? pm[a.by] : null;
    const locked = lockInfo(s, now).locked && !admin;
    const log = (act, pid) => {
      s.log.unshift({ ts: now, by: me ? me.id : null, act, pid: pid || null });
      if (s.log.length > 300) s.log.length = 300;
    };
    const addedByMe = () => s.presences.filter(x => x.by === a.by && x.pid !== a.by).length;
    const limit = Number(s.settings.guestLimit) || 3;

    if (ADMIN_ONLY.has(a.type) && !admin) return fail('Só quem é admin pode fazer isso.');
    if (!ADMIN_ONLY.has(a.type) && !me && !admin && a.type !== 'suggest') return fail('Escolha quem você é antes (no topo da lista).');

    switch (a.type) {
      case 'join': {
        if (locked) return fail('A lista está fechada agora.');
        const p = pm[a.pid];
        if (!p) return fail('Jogador não encontrado.');
        if (s.presences.some(x => x.pid === p.id)) return ok;
        if (!admin && p.id !== a.by && addedByMe() >= limit) return fail(`Você já marcou ${limit} pessoas além de você. Esse é o limite.`);
        s.presences.push({ pid: p.id, by: me ? me.id : null, ts: now });
        log('add', p.id);
        return ok;
      }
      case 'leave': {
        if (locked) return fail('A lista está fechada agora.');
        const before = s.presences.length;
        s.presences = s.presences.filter(x => x.pid !== a.pid);
        if (s.presences.length === before) return ok;
        delete s.roles[a.pid];
        log('remove', a.pid);
        return ok;
      }
      case 'addGuest': {
        if (locked) return fail('A lista está fechada agora.');
        const name = cleanName(a.name);
        if (name.length < 2) return fail('Escreva o nome do convidado.');
        if (a.gender !== 'F' && a.gender !== 'M') return fail('Escolha o gênero do convidado.');
        if (!admin && addedByMe() >= limit) return fail(`Você já marcou ${limit} pessoas além de você. Esse é o limite.`);
        let p = s.players.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (p && !p.guest) return fail(`${p.name} já está no grupo. Marque na lista.`);
        if (!p) {
          p = { id: newId(s, 'c'), name, gender: a.gender, skill: clampSkill(a.skill), paid: false, guest: true, photo: null, freq: 0 };
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
        if (!p) { p = { id: newId(s, 'p'), photo: null, freq: 0 }; s.players.push(p); }
        Object.assign(p, { name, gender: a.gender, skill: clampSkill(a.skill), paid: !!a.paid, guest: !!a.guest });
        return ok;
      }
      case 'deletePlayer': {
        s.players = s.players.filter(x => x.id !== a.id);
        s.presences = s.presences.filter(x => x.pid !== a.id);
        delete s.roles[a.id];
        if (s.teams) s.teams.list = s.teams.list.map(t => t.filter(id => id !== a.id));
        return ok;
      }
      case 'togglePaid': { const p = pm[a.id]; if (p) p.paid = !p.paid; return ok; }
      case 'settings': {
        const st = s.settings;
        if (a.groupName !== undefined) st.groupName = cleanName(a.groupName) || 'Vôlei';
        if (a.title !== undefined) st.title = String(a.title).trim().slice(0, 60);
        if (a.date !== undefined) st.date = String(a.date).slice(0, 10);
        if (a.start !== undefined) st.start = String(a.start).slice(0, 5);
        if (a.end !== undefined) st.end = String(a.end).slice(0, 5);
        if (a.max !== undefined) st.max = Math.min(60, Math.max(4, Math.round(Number(a.max) || 18)));
        if (a.perTeam !== undefined) st.perTeam = Math.min(9, Math.max(2, Math.round(Number(a.perTeam) || 6)));
        if (a.guestLimit !== undefined) st.guestLimit = Math.min(10, Math.max(0, Math.round(Number(a.guestLimit) || 0)));
        return ok;
      }
      case 'lockNow': {
        const m = Math.min(60 * 24 * 7, Math.max(1, Math.round(Number(a.minutes) || 0)));
        s.settings.manualLockUntil = now + m * 60000;
        return ok;
      }
      case 'unlock': s.settings.manualLockUntil = 0; return ok;
      case 'autoLock': {
        s.settings.autoLock = { enabled: !!a.enabled, day: Math.min(6, Math.max(0, Number(a.day) || 0)), from: String(a.from || '00:00').slice(0, 5), to: String(a.to || '00:00').slice(0, 5) };
        return ok;
      }
      case 'resetPresences': {
        const d = derive(s);
        d.confirmed.forEach(id => { const p = pm[id]; if (p) p.freq = (p.freq || 0) + 1; });
        s.presences = []; s.roles = {}; s.teams = null; s.log = [];
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

  return { DAYS, initialState, derive, apply, lockInfo, drawTeams, publicState, ADMIN_ONLY };
});
