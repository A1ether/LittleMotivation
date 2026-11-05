/* 上班动力看板 — 纯前端，无依赖
   设计原则：
   1. 一切以「此刻」为准，不靠累加计时器（切后台、休眠回来都不会算错）
   2. 数据只存 localStorage，不上传
   3. 每秒刷新只改文本，不改布局（等宽数字 + 定宽结构）
*/

(() => {
  'use strict';

  const STORAGE_KEY = 'little-motivation:config:v1';

  const DEFAULTS = {
    salary: 10000,      // 月薪（元）
    workDays: 21.75,    // 每月工作日（法定平均 21.75）
    start: '09:30',     // 上班
    end: '18:30',       // 下班
    overtime: false,    // 下班后继续计薪
    forceWorkToday: false,
    theme: '',          // '' = 跟随系统
    masked: false,
  };

  const MILESTONES = [
    { ico: '☕', name: '一杯咖啡', price: 15 },
    { ico: '🧋', name: '一杯奶茶', price: 18 },
    { ico: '🍜', name: '一顿午饭', price: 30 },
    { ico: '🍰', name: '一份下午茶', price: 45 },
    { ico: '🎬', name: '一张电影票', price: 60 },
    { ico: '📚', name: '一本小书', price: 88 },
    { ico: '🍲', name: '一顿小聚', price: 120 },
    { ico: '🎧', name: '一副耳机', price: 200 },
  ];

  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;

  const $ = (id) => document.getElementById(id);
  const el = {
    root: document.documentElement,
    hero: $('hero'),
    heroLabel: $('heroLabel'),
    live: $('liveBadge'),
    liveText: $('liveText'),
    now: $('nowLabel'),
    amtInt: $('amtInt'),
    amtDec: $('amtDec'),
    amtDec2: $('amtDec2'),
    rates: $('rates'),
    bar: $('bar'),
    barFill: $('barFill'),
    pct: $('pct'),
    labelStart: $('labelStart'),
    labelEnd: $('labelEnd'),
    countdownKey: $('countdownKey'),
    countdown: $('countdown'),
    worked: $('worked'),
    goal: $('goal'),
    status: $('status'),
    forceBtn: $('forceBtn'),
    rwGrid: $('rwGrid'),
    rwCount: $('rwCount'),
    privacyBtn: $('privacyBtn'),
    themeBtn: $('themeBtn'),
    settingsBtn: $('settingsBtn'),
    dialog: $('settingsDialog'),
    fSalary: $('fSalary'),
    fDays: $('fDays'),
    fStart: $('fStart'),
    fEnd: $('fEnd'),
    fOvertime: $('fOvertime'),
    fForce: $('fForce'),
    cfgHint: $('cfgHint'),
    resetBtn: $('resetBtn'),
  };

  // ── 配置 ─────────────────────────────────────────────
  let cfg = loadCfg();

  function loadCfg() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const merged = { ...DEFAULTS, ...raw };
      merged.salary = Math.max(0, Number(merged.salary) || 0);
      merged.workDays = Math.min(31, Math.max(1, Number(merged.workDays) || DEFAULTS.workDays));
      if (!isHM(merged.start)) merged.start = DEFAULTS.start;
      if (!isHM(merged.end)) merged.end = DEFAULTS.end;
      return merged;
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveCfg() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {
      /* 隐私模式下写入可能失败，忽略即可 */
    }
  }

  function isHM(s) {
    return typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
  }

  function toMinutes(hm) {
    const [h, m] = hm.split(':').map(Number);
    return h * 60 + m;
  }

  function toHM(mins) {
    const m = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  // ── 时间与算钱 ───────────────────────────────────────
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function isWorkday(d) {
    const w = d.getDay();
    return w >= 1 && w <= 5;
  }

  function shiftDurationSec() {
    const s = toMinutes(cfg.start);
    const e = toMinutes(cfg.end);
    const mins = e >= s ? e - s : e + 1440 - s; // 支持跨夜班
    return Math.max(1, mins * 60);
  }

  function dailyPay() {
    return cfg.salary / Math.max(1, cfg.workDays);
  }

  function perSecond() {
    return dailyPay() / shiftDurationSec();
  }

  function isWorkingToday(d) {
    return isWorkday(d) || cfg.forceWorkToday;
  }

  /**
   * 计算「当前这一班」：
   * 返回 null（今天不该上班）或 { start, end, todayShift: bool }
   * 跨夜班时，凌晨可能仍属于昨天那一班。
   */
  function currentShift(now) {
    const durMs = shiftDurationSec() * 1000;
    const today = startOfDay(now);
    const candidates = [];

    if (isWorkingToday(today)) {
      const s = today.getTime() + toMinutes(cfg.start) * MINUTE;
      candidates.push({ start: s, end: s + durMs, todayShift: true });
    }

    const yesterday = new Date(today.getTime() - DAY);
    if (isWorkingToday(yesterday) && toMinutes(cfg.end) <= toMinutes(cfg.start)) {
      const s = yesterday.getTime() + toMinutes(cfg.start) * MINUTE;
      candidates.push({ start: s, end: s + durMs, todayShift: false });
    }

    const active = candidates.find((c) => now.getTime() >= c.start && now.getTime() < c.end);
    if (active) return active;

    // 还没开工 / 已收工：取今天的班次用于倒计时
    return candidates.find((c) => c.todayShift) || null;
  }

  function model(now) {
    const d = dailyPay();
    const ps = perSecond();
    const shift = currentShift(now);

    const base = {
      perDay: d,
      perSecond: ps,
      pct: 0,
      earned: 0,
      mode: 'off',
      status: '',
      countdownKey: '—',
      countdown: '—',
      worked: '—',
    };

    if (!shift) {
      base.status = '今天是休息日，时间属于你自己';
      return base;
    }

    const { start, end } = shift;
    const t = now.getTime();

    if (t < start) {
      base.mode = 'before';
      base.countdownKey = '距开工';
      base.countdown = hms(start - t);
      base.status = `还没开工，先享受 ${hms(start - t)} 的自由`;
      return base;
    }

    const elapsed = Math.min(t - start, end - start);
    base.earned = elapsed / 1000 * ps;
    base.worked = hms(elapsed);
    base.pct = elapsed / (end - start);

    if (t < end) {
      base.mode = 'working';
      base.countdownKey = '距下班';
      base.countdown = hms(end - t);
      const remain = (end - t) / 1000 * ps;
      base.status = `再撑 ${hms(end - t)}，还有 ¥${remain.toFixed(2)} 在路上`;
    } else {
      base.mode = 'after';
      base.countdownKey = '今日状态';
      base.countdown = '已下班';
      base.status = `今天收工，进账 ¥${d.toFixed(2)}，去买点什么吧`;

      if (cfg.overtime) {
        const extra = (t - end) / 1000 * ps;
        base.earned = d + extra;
        base.countdown = `加班 ${hms(t - end)}`;
        base.status = `加班 ${hms(t - end)}，额外进账 ¥${extra.toFixed(2)}`;
      }
    }

    if (t >= end) base.pct = 1;
    return base;
  }

  function hms(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  /** 遮一遮时把文案里的金额也替换掉 */
  function maskMoney(text) {
    return text.replace(/¥[\d,]+(\.\d+)?/g, '¥•••');
  }

  // ── 渲染 ─────────────────────────────────────────────
  const textCache = new Map();
  function setText(node, key, value) {
    if (textCache.get(key) === value) return;
    textCache.set(key, value);
    node.textContent = value;
  }

  const fmt0 = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function renderAmount(v) {
    if (cfg.masked) {
      setText(el.amtInt, 'int', '•••');
      setText(el.amtDec, 'dec', '');
      setText(el.amtDec2, 'dec2', '');
      return;
    }
    const s = (Math.floor(v * 10000) / 10000).toFixed(4);
    const [int, frac] = s.split('.');
    setText(el.amtInt, 'int', fmt0.format(Number(int)));
    setText(el.amtDec, 'dec', '.' + frac.slice(0, 2));
    setText(el.amtDec2, 'dec2', frac.slice(2));
  }

  let lastMilestoneOn = new Set();
  let lastMilestoneEarned = -1;
  let rwNodes = [];

  function buildMilestones() {
    el.rwGrid.innerHTML = '';
    for (const m of MILESTONES) {
      const li = document.createElement('li');
      li.className = 'rw';
      li.innerHTML = `
        <span class="rw-ico" aria-hidden="true">${m.ico}</span>
        <span class="rw-name">${m.name}</span>
        <span class="rw-price">¥${m.price}</span>
        <span class="rw-next"><span class="track"><span class="fill"></span></span><span class="gap">—</span></span>
      `;
      el.rwGrid.appendChild(li);
    }
    rwNodes = [...el.rwGrid.children].map((node) => ({
      node,
      gap: node.querySelector('.gap'),
      fill: node.querySelector('.fill'),
    }));
  }

  function renderMilestones(earned) {
    // 每 0.25s 一次渲染，这里按「分」级别变化才更新，省掉无谓的 DOM 写入
    if (Math.abs(earned - lastMilestoneEarned) < 0.01) return;
    lastMilestoneEarned = earned;

    let onCount = 0;
    let nextIdx = -1;
    const onSet = new Set();

    MILESTONES.forEach((m, i) => {
      const { node, gap, fill } = rwNodes[i];
      const isOn = earned >= m.price;
      const isNext = !isOn && nextIdx === -1;

      if (isOn) {
        onCount++;
        onSet.add(i);
      }
      if (isNext) nextIdx = i;

      node.classList.toggle('is-on', isOn);
      node.classList.toggle('is-next', isNext);

      if (!isOn) {
        gap.textContent = cfg.masked
          ? '还差 ¥•••'
          : `还差 ¥${(m.price - earned).toFixed(2)}`;
        fill.style.width = `${Math.min(100, (earned / m.price) * 100).toFixed(1)}%`;
      }

      if (isOn && !lastMilestoneOn.has(i)) {
        node.classList.remove('just-hit');
        void node.offsetWidth; // 强制重绘，让动画可重复播放
        node.classList.add('just-hit');
        setTimeout(() => node.classList.remove('just-hit'), 900);
      }
    });

    lastMilestoneOn = onSet;
    setText(el.rwCount, 'rwCount', `已点亮 ${onCount} 件`);
  }

  function render(now) {
    const m = model(now);

    el.hero.dataset.mode = m.mode;
    el.live.dataset.state = m.mode === 'working' || (m.mode === 'after' && cfg.overtime) ? 'on' : 'off';
    setText(el.liveText, 'liveText',
      m.mode === 'working' ? '进行中' : m.mode === 'before' ? '未开工' : m.mode === 'after' ? (cfg.overtime ? '加班中' : '已下班') : '休息日');

    setText(el.heroLabel, 'heroLabel',
      m.mode === 'working' ? '今日已赚 · 实时' : m.mode === 'before' ? '今日待赚' : '今日已赚');

    renderAmount(m.earned);

    const ps = m.perSecond;
    setText(el.rates, 'rates',
      cfg.masked
        ? '时薪 ¥••• · 分薪 ¥••• · 秒薪 ¥•••'
        : `时薪 ¥${fmt2.format(ps * 3600)} · 分薪 ¥${(ps * 60).toFixed(2)} · 秒薪 ¥${ps.toFixed(4)}`);

    const pct = Math.min(100, Math.max(0, m.pct * 100));
    el.barFill.style.width = `${pct.toFixed(2)}%`;
    el.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    setText(el.pct, 'pct', `${pct.toFixed(pct >= 10 ? 0 : 1)}%`);

    setText(el.labelStart, 'labelStart', cfg.start);
    setText(el.labelEnd, 'labelEnd', cfg.end);
    setText(el.countdownKey, 'countdownKey', m.countdownKey);
    setText(el.countdown, 'countdown', m.countdown);
    setText(el.worked, 'worked', m.mode === 'before' || m.mode === 'off' ? '—' : m.worked);
    setText(el.goal, 'goal', cfg.masked ? '•••' : `¥${fmt2.format(m.perDay)}`);
    setText(el.status, 'status', cfg.masked ? maskMoney(m.status) : m.status);

    const isRest = !isWorkday(startOfDay(now));
    el.forceBtn.hidden = !isRest;
    el.forceBtn.textContent = cfg.forceWorkToday ? '改回休息日' : '今天也上班 →';

    renderMilestones(m.earned);

    setText(el.now, 'now', formatNow(now));
    updateTitle(m);
  }

  function formatNow(d) {
    const pad = (n) => String(n).padStart(2, '0');
    const week = '日一二三四五六'[d.getDay()];
    return `${d.getMonth() + 1}月${d.getDate()}日 周${week} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  let lastTitleInt = '';
  function updateTitle(m) {
    if (cfg.masked) {
      if (lastTitleInt !== 'mask') document.title = '上班动力看板';
      lastTitleInt = 'mask';
      return;
    }
    const n = Math.floor(m.earned);
    if (String(n) !== lastTitleInt) {
      lastTitleInt = String(n);
      document.title = `¥${fmt0.format(n)} · 上班动力看板`;
    }
  }

  // ── 主题 / 遮一遮 ─────────────────────────────────────
  function applyTheme() {
    const dark = cfg.theme ? cfg.theme === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
    el.root.dataset.theme = dark ? 'dark' : 'light';
    el.themeBtn.title = dark ? '切换到浅色' : '切换到深色';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#08090b' : '#f4f1ea');
  }

  function applyMasked() {
    el.root.dataset.masked = String(cfg.masked);
    el.privacyBtn.setAttribute('aria-pressed', String(cfg.masked));
    el.privacyBtn.title = cfg.masked ? '取消遮罩（快捷键 B）' : '遮一遮（快捷键 B）';
    textCache.clear();
    lastTitleInt = '';
    lastMilestoneEarned = -1;
  }

  // ── 设置面板 ─────────────────────────────────────────
  function openSettings() {
    el.fSalary.value = cfg.salary;
    el.fDays.value = cfg.workDays;
    el.fStart.value = cfg.start;
    el.fEnd.value = cfg.end;
    el.fOvertime.checked = cfg.overtime;
    el.fForce.checked = cfg.forceWorkToday;
    updateHint();
    if (!el.dialog.open) el.dialog.showModal();
  }

  function readSettings() {
    const salary = Number(el.fSalary.value);
    const days = Number(el.fDays.value);
    // 输入框被清空时不更新，避免数字瞬间跳成 0
    if (el.fSalary.value !== '' && Number.isFinite(salary) && salary >= 0) cfg.salary = salary;
    if (el.fDays.value !== '' && Number.isFinite(days) && days >= 1 && days <= 31) cfg.workDays = days;
    if (isHM(el.fStart.value)) cfg.start = el.fStart.value;
    if (isHM(el.fEnd.value)) cfg.end = el.fEnd.value;
    cfg.overtime = el.fOvertime.checked;
    cfg.forceWorkToday = el.fForce.checked;
    saveCfg();
    textCache.clear();
    lastTitleInt = '';
    lastMilestoneEarned = -1;
    updateHint();
    render(new Date());
  }

  function updateHint() {
    const d = dailyPay();
    const ps = perSecond();
    const dur = shiftDurationSec();
    el.cfgHint.textContent =
      `日均 ¥${d.toFixed(2)} · 时薪 ¥${(ps * 3600).toFixed(2)} · 秒薪 ¥${ps.toFixed(4)}\n` +
      `每班 ${(dur / 3600).toFixed(1)} 小时（${cfg.start}–${cfg.end}）`;
  }

  // ── 事件 ─────────────────────────────────────────────
  el.settingsBtn.addEventListener('click', openSettings);
  el.resetBtn.addEventListener('click', () => {
    cfg = { ...DEFAULTS, theme: cfg.theme, masked: cfg.masked };
    saveCfg();
    applyMasked();
    openSettings();
    render(new Date());
  });

  for (const input of [el.fSalary, el.fDays, el.fStart, el.fEnd, el.fOvertime, el.fForce]) {
    input.addEventListener('input', readSettings);
    input.addEventListener('change', readSettings);
  }

  el.dialog.addEventListener('close', () => {
    textCache.clear();
    lastTitleInt = '';
    lastMilestoneEarned = -1;
    render(new Date());
  });

  el.privacyBtn.addEventListener('click', () => {
    cfg.masked = !cfg.masked;
    saveCfg();
    applyMasked();
    render(new Date());
  });

  el.themeBtn.addEventListener('click', () => {
    const darkNow = el.root.dataset.theme === 'dark';
    cfg.theme = darkNow ? 'light' : 'dark';
    saveCfg();
    applyTheme();
  });

  el.forceBtn.addEventListener('click', () => {
    cfg.forceWorkToday = !cfg.forceWorkToday;
    saveCfg();
    textCache.clear();
    lastTitleInt = '';
    lastMilestoneEarned = -1;
    render(new Date());
  });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || el.dialog.open) return;
    if (e.key === 's' || e.key === 'S') openSettings();
    if (e.key === 'b' || e.key === 'B') el.privacyBtn.click();
  });

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!cfg.theme) applyTheme();
  });

  // ── 启动 ─────────────────────────────────────────────
  applyTheme();
  applyMasked();
  buildMilestones();
  render(new Date());

  let rafTimer = null;
  const loop = () => {
    render(new Date());
    rafTimer = setTimeout(loop, 250);
  };
  loop();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render(new Date());
  });
})();
