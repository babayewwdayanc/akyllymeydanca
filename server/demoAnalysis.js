// ДЕМО-анализ: симулятор матча, который выдаёт данные в ТОМ ЖЕ формате, что и настоящий AI
// (ai/analyze.py). Нужен, чтобы приложение работало и показывало статистику ещё до подключения
// компьютерного зрения. Цифры здесь выдуманы — это не анализ реального видео.
//
// Формат результата: "akylly-analysis/v1" (описание — ai/SCHEMA.md).

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r1 = (v) => Math.round(v * 10) / 10;

function rolesFor(n) {
  const outfield = n - 1;
  const fwd = Math.max(1, Math.round(outfield * 0.2));
  const def = Math.max(1, Math.round(outfield * 0.4));
  const mid = Math.max(0, outfield - fwd - def);
  return ['GK', ...Array(def).fill('DEF'), ...Array(mid).fill('MID'), ...Array(fwd).fill('FWD')];
}

const ROLE_X = { GK: 0.04, DEF: 0.26, MID: 0.46, FWD: 0.66 };

export function simulateMatch({ durationS = 3600, perSide = 6, length = 40, width = 20, seed = 1 } = {}) {
  const rnd = mulberry32(seed * 7919 + 13);
  const R = (a, b) => a + (b - a) * rnd();
  const L = length;
  const W = width;

  // --- Игроки ---
  const players = [];
  for (const team of ['A', 'B']) {
    const roles = rolesFor(perSide);
    const usedNumbers = new Set();
    const counts = {};
    roles.forEach((role) => (counts[role] = (counts[role] || 0) + 1));
    const seen = {};
    roles.forEach((role, i) => {
      seen[role] = (seen[role] || 0) + 1;
      let jersey = role === 'GK' ? 1 : Math.floor(R(2, 30));
      while (usedNumbers.has(jersey)) jersey = Math.floor(R(2, 30));
      usedNumbers.add(jersey);
      const slot = seen[role] / (counts[role] + 1); // равномерно по ширине поля
      const ax = ROLE_X[role] * L;
      players.push({
        track_no: players.length + 1,
        team,
        role,
        jersey,
        anchor: [team === 'A' ? ax : L - ax, role === 'GK' ? W / 2 : slot * W],
        pos: [team === 'A' ? ax : L - ax, role === 'GK' ? W / 2 : slot * W],
        maxSpeed: R(22, 31) / 3.6, // м/с
        cruise: R(1.0, 2.2),
        passSkill: R(0.8, 0.95),
        finishing: R(0.12, 0.42) + (role === 'FWD' ? 0.08 : 0),
        defense: R(0.3, 0.85) + (role === 'DEF' ? 0.1 : 0),
        save: role === 'GK' ? R(0.45, 0.72) : 0.2,
        inSprint: 0,
      });
    });
  }
  const teamOf = (t) => players.filter((p) => p.team === t);
  const gkOf = (t) => players.find((p) => p.team === t && p.role === 'GK');
  const attackSign = (t) => (t === 'A' ? 1 : -1);
  const goalX = (t) => (t === 'A' ? L : 0); // ворота, которые атакует команда t
  const opp = (t) => (t === 'A' ? 'B' : 'A');

  const events = [];
  const frames = [];
  const possessionS = { A: 0, B: 0 };
  const score = { A: 0, B: 0 };

  let holder = players.find((p) => p.team === 'A' && p.role === 'MID') || teamOf('A')[1];
  let ball = [L / 2, W / 2];
  let ballTarget = null; // мяч в полёте
  let actionIn = 3;
  let lastPass = null;
  let stoppage = 0;

  const ev = (t, type, p, extra = {}) =>
    events.push({ t: r1(t + rnd() * 0.9), type, team: p.team, track_no: p.track_no, x: r1(ball[0]), y: r1(ball[1]), ...extra });

  const nearest = (list, pt) => list.reduce((a, b) => (dist(b.pos, pt) < dist(a.pos, pt) ? b : a));

  for (let t = 0; t < durationS; t++) {
    const T = holder.team;

    // --- Действие игрока с мячом ---
    if (stoppage > 0) {
      stoppage--;
    } else if (--actionIn <= 0) {
      const sign = attackSign(T);
      const dGoal = Math.hypot(goalX(T) - ball[0], (W / 2 - ball[1]) * 0.6);
      const opponents = teamOf(opp(T));
      const presser = nearest(opponents, ball);
      const pressure = dist(presser.pos, ball) < 1.5 ? 0.06 : 0;
      let shootP = dGoal < 8 ? 0.55 : dGoal < 15 ? 0.24 : dGoal < 22 ? 0.05 : 0.01;
      if (holder.role === 'FWD') shootP *= 1.3;
      if (holder.role === 'GK') shootP = 0;
      const dribbleP = holder.role === 'GK' ? 0 : 0.22;
      const roll = rnd();

      if (roll < shootP) {
        // Удар
        const speed = R(52, 112) + (holder.role === 'FWD' ? 6 : 0);
        const onTarget = rnd() < 0.45 + holder.finishing * 0.4 - pressure;
        const gk = gkOf(opp(T));
        ev(t, 'shot', holder, { success: onTarget ? 1 : 0, speed_kmh: r1(speed) });
        if (onTarget) {
          const goalP = clamp(0.32 + holder.finishing * 0.6 - gk.save * 0.3 + (dGoal < 6 ? 0.12 : 0), 0.1, 0.75);
          if (rnd() < goalP) {
            const assist = lastPass && lastPass.team === T && lastPass.to === holder.track_no && t - lastPass.t <= 12 ? lastPass.from : null;
            ball = [goalX(T), W / 2 + R(-1.2, 1.2)];
            ev(t, 'goal', holder, { target_track_no: assist, speed_kmh: r1(speed) });
            score[T]++;
            // Розыгрыш с центра — соперник
            holder = nearest(teamOf(opp(T)).filter((p) => p.role !== 'GK'), [L / 2, W / 2]);
            ball = [L / 2, W / 2];
            stoppage = Math.floor(R(15, 30));
          } else {
            ev(t, 'save', gk, { target_track_no: holder.track_no });
            holder = gk;
            ball = [...gk.pos];
          }
        } else {
          holder = gkOf(opp(T));
          ball = [goalX(T) - sign * 2, W / 2];
          stoppage = Math.floor(R(4, 10));
        }
        lastPass = null;
        actionIn = Math.floor(R(3, 6));
      } else if (roll < shootP + dribbleP) {
        // Обводка / ведение мяча
        const tackleP = dist(presser.pos, ball) < 3 ? 0.12 + presser.defense * 0.18 : 0.05;
        if (rnd() < tackleP) {
          ev(t, 'tackle', presser, { target_track_no: holder.track_no });
          ev(t, 'turnover', holder);
          holder = presser;
          lastPass = null;
        } else {
          ball = [clamp(ball[0] + sign * R(2, 6), 1, L - 1), clamp(ball[1] + R(-3, 3), 1, W - 1)];
        }
        actionIn = Math.floor(R(2, 5));
      } else {
        // Пас
        const mates = teamOf(T).filter((p) => p !== holder);
        const weights = mates.map((m) => {
          const progress = (m.pos[0] - holder.pos[0]) * sign;
          const d = dist(m.pos, holder.pos);
          let w = 1 + Math.max(0, progress) / 4;
          if (d > 18) w *= 0.3;
          if (m.role === 'GK') w *= 0.15;
          return w;
        });
        let pick = rnd() * weights.reduce((a, b) => a + b, 0);
        let receiver = mates[0];
        for (let i = 0; i < mates.length; i++) {
          pick -= weights[i];
          if (pick <= 0) { receiver = mates[i]; break; }
        }
        const d = dist(receiver.pos, holder.pos);
        const okP = clamp(holder.passSkill - 0.003 * d - pressure, 0.5, 0.97);
        const travel = R(0.7, 1.5);
        const speed = r1((d / travel) * 3.6);
        if (rnd() < okP) {
          ev(t, 'pass', holder, { target_track_no: receiver.track_no, success: 1, speed_kmh: speed });
          lastPass = { from: holder.track_no, to: receiver.track_no, team: T, t };
          holder = receiver;
        } else {
          ev(t, 'pass', holder, { target_track_no: receiver.track_no, success: 0, speed_kmh: speed });
          const mid = [(holder.pos[0] + receiver.pos[0]) / 2, (holder.pos[1] + receiver.pos[1]) / 2];
          const interceptor = nearest(teamOf(opp(T)), mid);
          ball = mid;
          // Половина неточных пасов уходит в аут — без перехвата
          if (rnd() < 0.5) ev(t, 'interception', interceptor);
          else stoppage = Math.floor(R(3, 8));
          holder = interceptor;
          lastPass = null;
        }
        ballTarget = holder;
        actionIn = Math.floor(R(3, 7));
      }
    }

    possessionS[holder.team]++;

    // --- Движение игроков ---
    const shiftX = (ball[0] - L / 2) * 0.35;
    const shiftY = (ball[1] - W / 2) * 0.2;
    const chaserA = nearest(teamOf('A').filter((p) => p.role !== 'GK' && p !== holder), ball);
    const chaserB = nearest(teamOf('B').filter((p) => p.role !== 'GK' && p !== holder), ball);
    for (const p of players) {
      let target;
      if (p === holder) {
        target = [clamp(ball[0], 0.5, L - 0.5), clamp(ball[1], 0.5, W - 0.5)];
      } else if (p === chaserA || p === chaserB) {
        const own = p.team === holder.team;
        target = own ? [ball[0] + attackSign(p.team) * 4, ball[1] + (p.anchor[1] > W / 2 ? 3 : -3)] : [...ball];
      } else if (p.role === 'GK') {
        target = [p.anchor[0], clamp(W / 2 + (ball[1] - W / 2) * 0.3, W / 2 - 3, W / 2 + 3)];
      } else {
        const attacking = p.team === holder.team ? attackSign(p.team) * 3 : -attackSign(p.team) * 2;
        target = [p.anchor[0] + shiftX + attacking, p.anchor[1] + shiftY];
      }
      target = [clamp(target[0] + R(-0.6, 0.6), 0.3, L - 0.3), clamp(target[1] + R(-0.6, 0.6), 0.3, W - 0.3)];
      const d = dist(p.pos, target);
      let v = d > 9 && rnd() < 0.5 ? p.maxSpeed * R(0.75, 1) : Math.min(d, p.cruise * R(0.6, 1.4));
      v = Math.min(v, p.maxSpeed);
      if (d > 0.01) {
        p.pos = [p.pos[0] + ((target[0] - p.pos[0]) / d) * Math.min(v, d), p.pos[1] + ((target[1] - p.pos[1]) / d) * Math.min(v, d)];
      }
    }
    if (ballTarget) {
      ball = [...ballTarget.pos];
      ballTarget = null;
    } else if (stoppage === 0) {
      ball = [...holder.pos];
    }

    frames.push({ t, ball: [r1(ball[0]), r1(ball[1])], p: players.map((p) => [r1(p.pos[0]), r1(p.pos[1])]) });
  }

  return {
    schema: 'akylly-analysis/v1',
    source: 'demo-simulator',
    duration_s: durationS,
    pitch: { length_m: L, width_m: W },
    score,
    possession: { A: r1((possessionS.A / durationS) * 100) / 100, B: r1((possessionS.B / durationS) * 100) / 100 },
    tracks: players.map((p) => ({ track_no: p.track_no, team: p.team, jersey: p.jersey, role: p.role, thumbnail: null })),
    events: events.sort((a, b) => a.t - b.t),
    frames_hz: 1,
    frame_tracks: players.map((p) => p.track_no),
    frames,
  };
}
