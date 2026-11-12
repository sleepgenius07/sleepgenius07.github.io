// ============================================================
//  艾宾浩斯复习日程：应用脚本
//  结构：1) 数据层  2) 计算  3) 操作  4) 画界面  5) 启动
//  画界面的思路没变：每次数据变化，就调用 render() 把整个界面重画一遍。
// ============================================================

// ========== 1) 数据层 ==========
const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30];       // 学完后第几天复习
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
// 存数据用的名字。千万不要改：改了以后，老用户以前记的内容就读不出来了
const LS_KEY = 'ebbinghaus-pwa-v1';
// 存“科目框”设置用的名字（一共几个框、每个框叫什么）
const LS_SETTINGS = 'ebbinghaus-settings-v1';
// 存“坚持项”用的名字（每天都要打卡的事，比如背单词；它们不参与艾宾浩斯排期）
const LS_HABITS = 'ebbinghaus-habits-v1';
// 记住“今天的摘要已经看过了”，只在这次打开期间有效（关掉标签页就忘）
const SS_DISMISSED = 'ebbinghaus-summary-dismissed';
const MAX_BOXES = 12;        // 科目框最多几个
const MAX_LINES = 12;        // 每个框最多写几行
const MAX_HABITS = 12;       // 坚持项最多几个
const LINE_H = 32;           // 输入框里一行的高度（要和 app.css 里 textarea 的 line-height 一致）
const CHART_MIN_DAYS = 5;    // 复习强度图：最少显示几天（放到最大）
const CHART_MAX_DAYS = 180;  // 复习强度图：最多显示几天（缩到最小）

function dateToKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function keyToDate(k) { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function startOfToday() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function daysBetween(a, b) { return Math.round((a - b) / 86400000); }
function fmtDate(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
function fmtShort(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
function toLines(text) { return (text || '').split('\n').map(l => l.trim()).filter(Boolean); }

// “记忆保持率”的示意公式：隔 days 天不复习，大约还记得多少（最低 20%）。
// 和首页那张图用的是同一个公式，只是示意，不是对个人记忆的测量。
function retentionRate(days) { return 0.2 + 0.8 * Math.exp(-0.45 * days); }

let state = {
  entries: {},        // 学习内容： { '2026-11-12': ['知识点A', '知识点B'] }
  completed: {},      // 完成记录： { '复习日期::学习日期::内容': true }
  // 科目框：记录那一栏里的小框，每个框有自己的名字（可以不起名字）。至少有一个。
  // 例： [ {name:'英语'}, {name:'数学'} ]
  settings: { subjects: [{ name: '' }] },
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  selectedDate: startOfToday(),
  // 坚持项：每天都要打卡的事。 id 是内部编号，on 表示还在坚持（ON）还是已经停止（OFF）
  // 例： [ {id:'h1', name:'背英语单词', on:true} ]
  habits: [],
  habitChecks: {},    // 打卡记录： { '坚持项id::日期': true }
  confirm: null,      // “再次询问”弹窗正在问的事： { id 要删除的坚持项 }
  boxText: [''],      // 每个科目框里正在写的字，顺序和 settings.subjects 一一对应
  chart: null,        // 复习强度图现在显示的范围： { start 第一天, days 一共几天, yTop 纵轴最高到多少, month 对应日历的哪个月 }
  dialog: null,       // 现在打开的弹窗：null / 'summary' 今日摘要 / 'overdue' 逾期清单 / 'data' 备份 / 'confirm' 再次询问
  dialogFresh: false, // 弹窗是不是刚打开（刚打开时播放一次出现的动画）
  overdueShot: [],    // 打开弹窗那一刻的逾期清单（这样打了勾的条目不会马上从眼前消失）
  dataMsg: ''         // 备份弹窗里显示的结果提示
};

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      state.entries = d.entries || {};
      state.completed = d.completed || {};
    }
  } catch (e) {}
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) state.settings.subjects = cleanSubjects(JSON.parse(raw).subjects);
  } catch (e) {}
  state.boxText = state.settings.subjects.map(() => '');
  try {
    const raw = localStorage.getItem(LS_HABITS);
    if (raw) {
      const d = JSON.parse(raw);
      state.habits = cleanHabits(d.habits);
      state.habitChecks = (d.checks && typeof d.checks === 'object') ? d.checks : {};
    }
  } catch (e) {}
}
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ entries: state.entries, completed: state.completed }));
  } catch (e) {}
}
function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch (e) {}
}
function saveHabits() {
  try { localStorage.setItem(LS_HABITS, JSON.stringify({ habits: state.habits, checks: state.habitChecks })); } catch (e) {}
}
// 检查一遍坚持项，防止读到坏数据
function cleanHabits(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(x => x && typeof x.id === 'string' && x.id).slice(0, MAX_HABITS)
    .map(x => ({ id: x.id, name: typeof x.name === 'string' ? x.name.slice(0, 16) : '', on: x.on !== false }));
}
// 检查一遍科目框的设置，防止读到坏数据。至少留一个框，最多 12 个
function cleanSubjects(list) {
  const out = Array.isArray(list)
    ? list.slice(0, MAX_BOXES).map(s => ({ name: typeof (s && s.name) === 'string' ? s.name.slice(0, 12) : '' }))
    : [];
  return out.length ? out : [{ name: '' }];
}

// ========== 2) 计算 ==========
function doneKey(dueKey, learnedOn, content) { return dueKey + '::' + learnedOn + '::' + content; }
function isCompleted(dueKey, content, learnedOn) { return !!state.completed[doneKey(dueKey, learnedOn, content)]; }

// 复习表：{ 复习日期: [ {content, learnedOn, reviewRound, interval}, ... ] }
function getReviewMap() {
  const map = {};
  Object.keys(state.entries).forEach(dk => {
    const items = state.entries[dk];
    const ld = keyToDate(dk);
    REVIEW_INTERVALS.forEach((interval, idx) => {
      const rk = dateToKey(addDays(ld, interval));
      if (!map[rk]) map[rk] = [];
      items.forEach(item => map[rk].push({ content: item, learnedOn: dk, reviewRound: idx + 1, interval }));
    });
  });
  return map;
}

// 逾期：复习日期已经过去、还没打勾的
function getOverdue(rMap) {
  const today = startOfToday(); const arr = [];
  Object.keys(rMap).sort().forEach(dk => {
    if (keyToDate(dk) < today) {
      rMap[dk].forEach(r => { if (!isCompleted(dk, r.content, r.learnedOn)) arr.push({ ...r, dueDate: dk }); });
    }
  });
  return arr;
}

// 连续坚持天数：某一天的复习全部完成才算，断了就重新数
function getStreak(rMap) {
  let count = 0; let cd = startOfToday();
  const allDone = dk => (rMap[dk] || []).every(r => isCompleted(dk, r.content, r.learnedOn));
  const tKey = dateToKey(cd); const tRevs = rMap[tKey] || []; const tLearned = state.entries[tKey] || [];
  if (!tRevs.length && !tLearned.length) cd = addDays(cd, -1);        // 今天什么都没有：从昨天开始数
  else if (tRevs.length && !allDone(tKey)) cd = addDays(cd, -1);      // 今天还没复习完：先不算今天
  for (let i = 0; i < 365; i++) {
    const dk = dateToKey(cd); const revs = rMap[dk] || []; const learned = state.entries[dk] || [];
    if (!revs.length && !learned.length) break;
    if (revs.length && !allDone(dk)) break;
    count++; cd = addDays(cd, -1);
  }
  return count;
}

// 日历的 42 个格子（6 行 × 7 列），包括上个月末和下个月初补位的几天
function getCalDays(y, m) {
  const first = new Date(y, m, 1); const last = new Date(y, m + 1, 0); const days = [];
  for (let i = first.getDay() - 1; i >= 0; i--) days.push({ date: new Date(y, m, -i), outside: true });
  for (let i = 1; i <= last.getDate(); i++) days.push({ date: new Date(y, m, i), outside: false });
  const rem = 42 - days.length;
  for (let i = 1; i <= rem; i++) days.push({ date: new Date(y, m + 1, i), outside: true });
  return days;
}

// 某一天复习的情况：一共几项、完成几项、状态（'' 没有 / done 全部完成 / late 逾期 / due 待复习）
function dayLoad(rMap, date, today) {
  const dk = dateToKey(date);
  const revs = rMap[dk] || [];
  const done = revs.filter(r => isCompleted(dk, r.content, r.learnedOn)).length;
  const st = !revs.length ? '' : done === revs.length ? 'done' : date < today ? 'late' : 'due';
  return { total: revs.length, done, state: st };
}

// --- 坚持项的计算 ---
function habitKey(id, dateKey) { return id + '::' + dateKey; }
function habitChecked(id, dateKey) { return !!state.habitChecks[habitKey(id, dateKey)]; }
function habitLabel(hb) { return (hb.name || '').trim() || '没起名字的坚持项'; }
// 连续打卡几天：今天打了就从今天往前数，今天还没打就从昨天往前数
function habitStreak(id) {
  let d = startOfToday(), n = 0;
  if (!habitChecked(id, dateToKey(d))) d = addDays(d, -1);
  while (habitChecked(id, dateToKey(d))) { n++; d = addDays(d, -1); }
  return n;
}
// 一共打过几天卡
function habitTotal(id) { return Object.keys(state.habitChecks).filter(k => k.startsWith(id + '::')).length; }
// 今天还在坚持（ON）的坚持项
function activeHabits() { return state.habits.filter(hb => hb.on); }

// 按“哪天学的”分组
function groupByLearned(list) {
  const groups = {};
  list.forEach(r => { (groups[r.learnedOn] = groups[r.learnedOn] || []).push(r); });
  return Object.keys(groups).sort().map(k => ({ learnedOn: k, items: groups[k] }));
}

// ========== 3) 操作 ==========
function toggleCompleted(dueKey, content, learnedOn) {
  const k = doneKey(dueKey, learnedOn, content);
  if (state.completed[k]) delete state.completed[k];
  else state.completed[k] = true;
  saveState(); render();
}

function goToDate(d) {
  state.selectedDate = d; state.currentMonth = d.getMonth(); state.currentYear = d.getFullYear();
  render();
}

// 科目框里现在有没有写东西
function hasInput() { return state.boxText.some(t => (t || '').trim()); }

// 把所有科目框里的内容加到选中的那一天。
// 框有名字时，每条前面自动加上“名字：”，例如在“英语”框里写 abandon，存成“英语：abandon”；
// 框没有名字，就原样保存
function addEntries() {
  const lines = [];
  state.settings.subjects.forEach((s, i) => {
    const name = (s.name || '').trim();
    toLines(state.boxText[i]).forEach(l => {
      lines.push(!name || l.startsWith(name + '：') || l.startsWith(name + ':') ? l : name + '：' + l);
    });
  });
  if (!lines.length) return;
  const k = dateToKey(state.selectedDate);
  if (!state.entries[k]) state.entries[k] = [];
  lines.forEach(l => state.entries[k].push(l));
  state.boxText = state.settings.subjects.map(() => '');
  saveState(); render();
}

// 删除一条学习内容（连同它的完成记录），并给一次撤销的机会
function deleteEntry(dayKey, idx) {
  const item = state.entries[dayKey][idx];
  const backup = { entries: JSON.stringify(state.entries), completed: JSON.stringify(state.completed) };
  state.entries[dayKey] = state.entries[dayKey].filter((_, i) => i !== idx);
  if (state.entries[dayKey].length === 0) delete state.entries[dayKey];
  // 同一天如果还有一条一模一样的内容，完成记录要留着；否则一起删掉
  if (!(state.entries[dayKey] || []).includes(item)) {
    Object.keys(state.completed).forEach(k => { if (k.endsWith('::' + dayKey + '::' + item)) delete state.completed[k]; });
  }
  saveState(); render();
  showToast('已删除“' + (item.length > 14 ? item.slice(0, 14) + '…' : item) + '”', '撤销', () => {
    state.entries = JSON.parse(backup.entries);
    state.completed = JSON.parse(backup.completed);
    saveState(); render();
  });
}

// --- 科目框：新建一个、删掉一个 ---
function addBox() {
  if (state.settings.subjects.length >= MAX_BOXES) return;
  state.settings.subjects.push({ name: '' });
  state.boxText.push('');
  saveSettings(); render();
  // 新建之后，把光标放进新框的名字里，方便马上起名字
  const el = document.querySelector('[data-fk="box-name:' + (state.settings.subjects.length - 1) + '"]');
  if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); }
}
function removeBox(i) {
  if (state.settings.subjects.length <= 1) return;
  state.settings.subjects.splice(i, 1);
  state.boxText.splice(i, 1);
  saveSettings(); render();
}

// --- 坚持项：新建、开关、打卡、删除 ---
function addHabit() {
  if (state.habits.length >= MAX_HABITS) return;
  const id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);     // 随手生成一个不会重复的编号
  state.habits.push({ id, name: '', on: true });
  saveHabits(); render();
  const el = document.querySelector('[data-fk="habit-name:' + id + '"]');
  if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); }
}
function toggleHabitOn(id) {
  const hb = state.habits.find(x => x.id === id);
  if (!hb) return;
  hb.on = !hb.on;
  saveHabits(); render();
}
function toggleHabitCheck(id, dateKey) {
  const k = habitKey(id, dateKey);
  if (state.habitChecks[k]) delete state.habitChecks[k];
  else state.habitChecks[k] = true;
  saveHabits(); render();
}
// 双击坚持项的框：先弹出“再次询问”，点“确定”才真的删
function askDeleteHabit(id) {
  state.confirm = { id };
  openDialog('confirm');
  const btn = document.querySelector('[data-fk="confirm-no"]');     // 光标默认放在“再想想”上，按回车不会误删
  if (btn) btn.focus();
}
function deleteHabit(id) {
  state.habits = state.habits.filter(x => x.id !== id);
  Object.keys(state.habitChecks).forEach(k => { if (k.startsWith(id + '::')) delete state.habitChecks[k]; });
  saveHabits();
  state.confirm = null; state.dialog = null;
  render();
}

function openDialog(name) {
  state.dialog = name;
  state.dialogFresh = true;
  state.overdueShot = getOverdue(getReviewMap());
  state.dataMsg = '';
  render();
  const btn = document.querySelector('.dialog-close');     // 把键盘焦点放进弹窗
  if (btn) btn.focus();
}
function closeDialog() {
  if (state.dialog === 'summary') {
    try { sessionStorage.setItem(SS_DISMISSED, dateToKey(startOfToday())); } catch (e) {}
  }
  state.dialog = null;
  state.confirm = null;
  render();
}

// --- 备份：导出成一个文件 / 从文件导入 ---
function exportBackup() {
  const data = { app: 'ebbinghaus-review', version: 1, exportedAt: new Date().toISOString(), entries: state.entries, completed: state.completed, settings: state.settings, habits: { habits: state.habits, checks: state.habitChecks } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  // 文件名用英文：有些浏览器下载中文文件名会出问题
  a.download = 'ebbinghaus-backup-' + dateToKey(new Date()) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  state.dataMsg = '备份文件已经下载，文件名是 ' + a.download + '。';
  render();
}

// 导入是“合并”：只往里加，不会删掉或覆盖这台设备上已有的记录
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || typeof d.entries !== 'object' || d.entries === null || Array.isArray(d.entries)) throw new Error('format');
      let added = 0;
      Object.keys(d.entries).forEach(dk => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !Array.isArray(d.entries[dk])) return;
        d.entries[dk].forEach(item => {
          if (typeof item !== 'string' || !item.trim()) return;
          if (!state.entries[dk]) state.entries[dk] = [];
          if (!state.entries[dk].includes(item)) { state.entries[dk].push(item); added++; }
        });
      });
      let ticks = 0;
      if (d.completed && typeof d.completed === 'object') {
        Object.keys(d.completed).forEach(k => { if (d.completed[k] && !state.completed[k]) { state.completed[k] = true; ticks++; } });
      }
      saveState();
      // 科目框：这台设备上还是默认的一个没名字的框，才用备份里的
      const untouched = state.settings.subjects.length === 1 && !state.settings.subjects[0].name && !hasInput();
      if (untouched && d.settings) {
        state.settings.subjects = cleanSubjects(d.settings.subjects);
        state.boxText = state.settings.subjects.map(() => '');
        saveSettings();
      }
      // 坚持项：这台设备上没有的才加进来；打卡记录合并
      let newHabits = 0, newChecks = 0;
      if (d.habits && typeof d.habits === 'object') {
        cleanHabits(d.habits.habits).forEach(hb => {
          if (state.habits.length < MAX_HABITS && !state.habits.some(x => x.id === hb.id)) { state.habits.push(hb); newHabits++; }
        });
        const known = state.habits.map(x => x.id);
        Object.keys(d.habits.checks || {}).forEach(k => {
          if (d.habits.checks[k] && !state.habitChecks[k] && known.includes(k.split('::')[0])) { state.habitChecks[k] = true; newChecks++; }
        });
        saveHabits();
      }
      state.dataMsg = added || ticks || newHabits || newChecks
        ? '导入完成：新增 ' + added + ' 项学习内容、' + ticks + ' 条完成记录' + (newHabits || newChecks ? '、' + newHabits + ' 个坚持项、' + newChecks + ' 次打卡' : '') + '。'
        : '这份备份里的内容，这台设备上已经都有了。';
    } catch (e) {
      state.dataMsg = '这个文件读不出来。请选择从本站“导出”得到的 .json 文件。';
    }
    render();
  };
  reader.readAsText(file);
}

// --- 底部的小提示条（删除后可以撤销）。它不参与 render()，免得重画时打断正在输入的文字 ---
let toastTimer = null;
function showToast(text, actionLabel, action) {
  hideToast();
  const bar = h('div', { className: 'toast', role: 'status' },
    h('span', null, text),
    h('button', { type: 'button', onclick: () => { hideToast(); action(); } }, actionLabel));
  bar.id = 'toast';
  document.body.appendChild(bar);
  toastTimer = setTimeout(hideToast, 6000);
}
function hideToast() {
  clearTimeout(toastTimer);
  const old = document.getElementById('toast');
  if (old) old.remove();
}

// ========== 4) 画界面 ==========
// h('div', {className:'x', onclick:fn}, 子元素...) ：创建一个元素的小工具
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(k => {
    const v = attrs[k];
    if (v == null || v === false) return;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  });
  children.flat(Infinity).forEach(c => {
    if (c == null || c === false) return;
    if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(c));
    else if (c instanceof Node) el.appendChild(c);
  });
  return el;
}

// 小图标（SVG 线条）
const ICONS = {
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', close: 'M6 6l12 12M18 6L6 18', plus: 'M6 12h12M12 6v12'
};
function icon(name) {
  const s = h('span', { className: 'icon', 'aria-hidden': 'true' });
  s.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="' + ICONS[name] + '"/></svg>';
  return s;
}

// 一条可以打勾的复习内容。整行都能点。scope 用来区分“页面里的”和“弹窗里的”同一条
function checkRow(scope, dueKey, r, meta) {
  const done = isCompleted(dueKey, r.content, r.learnedOn);
  const late = !done && keyToDate(dueKey) < startOfToday();
  return h('button', {
    type: 'button', role: 'checkbox', 'aria-checked': String(done),
    className: 'item check-item' + (done ? ' is-done' : '') + (late ? ' is-late' : ''),
    'data-fk': scope + ':' + doneKey(dueKey, r.learnedOn, r.content),
    onclick: () => toggleCompleted(dueKey, r.content, r.learnedOn)
  },
    h('span', { className: 'box', 'aria-hidden': 'true' }),
    h('span', { className: 'item-text' }, r.content),
    meta ? h('span', { className: 'item-meta' }, meta) : null
  );
}

// 一组复习内容的小标题：哪天学的、第几次、保持率
function groupHead(g) {
  const rr = retentionRate(g.items[0].interval);
  return h('div', { className: 'group-head' },
    h('span', null, fmtDate(keyToDate(g.learnedOn)) + '学的'),
    h('span', { className: 'round' }, '第 ' + g.items[0].reviewRound + ' 次复习'),
    h('span', { className: 'keep', title: '示意值：隔这么多天不复习，大约还记得多少' },
      h('span', { className: 'keep-ink', style: { opacity: String(rr) } }),
      '保持率约 ' + Math.round(rr * 100) + '%')
  );
}

function render() {
  const today = startOfToday();
  const todayKey = dateToKey(today);
  const rMap = getReviewMap();
  const overdue = getOverdue(rMap);
  const streak = getStreak(rMap);
  const selKey = dateToKey(state.selectedDate);
  const dayReviews = rMap[selKey] || [];
  const dayLearned = state.entries[selKey] || [];
  const todayRevs = rMap[todayKey] || [];
  const todayDone = todayRevs.filter(r => isCompleted(todayKey, r.content, r.learnedOn)).length;
  const totalLearned = Object.values(state.entries).reduce((s, a) => s + a.length, 0);
  const totalDone = Object.keys(rMap).reduce((s, dk) => s + rMap[dk].filter(r => isCompleted(dk, r.content, r.learnedOn)).length, 0);
  const diff = daysBetween(state.selectedDate, today);
  const rel = diff === 0 ? '今天' : diff === 1 ? '明天' : diff === -1 ? '昨天' : diff > 0 ? diff + ' 天后' : (-diff) + ' 天前';
  // 小标签：现在选中的是哪一天
  const dayTag = () => h('span', { className: 'tag' + (diff === 0 ? ' now' : '') }, diff === 0 ? '今天' : fmtDate(state.selectedDate) + '，' + rel);

  // 重画之前，先记下：页面滚到哪了、键盘焦点在哪个元素上，画完再恢复
  const app = document.getElementById('app');
  const scrollY = window.scrollY;
  const scrolls = {};
  app.querySelectorAll('[data-sk]').forEach(el => { scrolls[el.dataset.sk] = el.scrollTop; });
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.fk : null;
  let caret = null;
  try { if (focusKey && typeof active.selectionStart === 'number') caret = [active.selectionStart, active.selectionEnd]; } catch (e) {}

  app.innerHTML = '';

  // ---------- 顶部一行：今天的情况 ----------
  const todayLeft = todayRevs.length - todayDone;
  let line;
  if (todayRevs.length === 0) line = totalLearned === 0 && !state.habits.length ? '还没有记录。写下今天学的内容，复习日程会自动排好。' : '今天没有要复习的内容。';
  else if (todayLeft === 0) line = '今天的 ' + todayRevs.length + ' 项都复习完了。';
  else line = '今天要复习 ' + todayRevs.length + ' 项，已完成 ' + todayDone + ' 项。';
  const act = activeHabits();
  if (act.length) line += '坚持项打卡 ' + act.filter(hb => habitChecked(hb.id, todayKey)).length + ' / ' + act.length + '。';

  app.appendChild(h('section', { className: 'strip' },
    h('div', { className: 'strip-inner' },
      h('div', { className: 'strip-main' },
        h('h1', null, fmtDate(today), h('small', null, '周' + WEEKDAYS[today.getDay()])),
        h('p', { className: 'strip-line' }, line)
      ),
      h('div', { className: 'strip-side' },
        streak > 0 ? h('span', { className: 'streak', title: '某一天的复习全部完成才算数' }, '连续 ', h('b', null, streak), ' 天') : null,
        overdue.length > 0 ? h('button', { type: 'button', className: 'chip late', 'data-fk': 'open-overdue', onclick: () => openDialog('overdue') }, '逾期 ' + overdue.length + ' 项') : null,
        h('button', { type: 'button', className: 'chip', 'data-fk': 'open-summary', onclick: () => openDialog('summary') }, '今日摘要'),
        h('button', { type: 'button', className: 'chip', 'data-fk': 'open-data', onclick: () => openDialog('data') }, '备份')
      )
    ),
    // 今日复习进度：贴在这一栏最下面的一条细线
    todayRevs.length > 0 ? h('div', { className: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(todayRevs.length), 'aria-valuenow': String(todayDone), 'aria-label': '今日复习进度' },
      h('div', { className: 'progress-fill' + (todayLeft === 0 ? ' full' : ''), style: { width: (todayDone / todayRevs.length * 100) + '%' } })) : null
  ));

  // 日历翻到了别的月份：复习强度图也回到那个月
  if (!state.chart || state.chart.month !== state.currentYear + '-' + state.currentMonth) resetChart();

  // ---------- 主体 ----------
  // 第一排三栏一样高，内容放不下时各自在栏里滚动：日历 | 记录 | 复习强度图。
  // 第二排两块：需要复习 | 这一天学的，内容多少页面就多长
  const row1 = h('div', { className: 'row1' });
  const row2 = h('div', { className: 'row2' });
  app.appendChild(h('div', { className: 'workspace' }, row1, row2));

  // ----- 日历 -----
  const cal = h('div', { className: 'sheet cal', 'data-sk': 'cal' });
  const moveMonth = n => {
    const d = new Date(state.currentYear, state.currentMonth + n, 1);
    state.currentYear = d.getFullYear(); state.currentMonth = d.getMonth(); render();
  };
  cal.appendChild(h('div', { className: 'cal-nav' },
    h('h2', null, state.currentYear + '年', h('b', null, (state.currentMonth + 1) + '月')),
    h('button', { type: 'button', className: 'cal-today', 'data-fk': 'cal-today', onclick: () => goToDate(today) }, '今天'),
    h('button', { type: 'button', className: 'cal-arrow', 'aria-label': '上个月', 'data-fk': 'cal-prev', onclick: () => moveMonth(-1) }, icon('left')),
    h('button', { type: 'button', className: 'cal-arrow', 'aria-label': '下个月', 'data-fk': 'cal-next', onclick: () => moveMonth(1) }, icon('right'))
  ));
  cal.appendChild(h('div', { className: 'cal-week', 'aria-hidden': 'true' }, WEEKDAYS.map(w => h('span', null, w))));

  const grid = h('div', { className: 'cal-grid' });
  getCalDays(state.currentYear, state.currentMonth).forEach(d => {
    const dk = dateToKey(d.date);
    const learned = (state.entries[dk] || []).length;
    const load = dayLoad(rMap, d.date, today);
    const isSel = sameDay(d.date, state.selectedDate);
    const isTd = sameDay(d.date, today);

    let label = fmtDate(d.date) + (isTd ? '，今天' : '');
    if (learned) label += '，学了 ' + learned + ' 项';
    if (load.total) label += '，复习 ' + load.done + '/' + load.total + (load.state === 'late' ? '，逾期' : '');

    grid.appendChild(h('button', {
      type: 'button',
      className: 'cal-day' + (isSel ? ' selected' : '') + (isTd ? ' today' : '') + (d.outside ? ' outside' : ''),
      'aria-label': label, 'aria-pressed': String(isSel), 'data-fk': 'day:' + dk,
      onclick: () => { state.selectedDate = d.date; render(); }
    },
      h('span', { className: 'cal-num' }, d.date.getDate()),
      h('span', { className: 'cal-dots' },
        learned ? h('i', { className: 'dot learned' }) : null,
        load.state ? h('i', { className: 'dot ' + load.state }) : null)
    ));
  });
  cal.appendChild(grid);
  cal.appendChild(h('div', { className: 'legend' },
    h('span', null, h('i', { className: 'dot learned' }), '学了新内容'),
    h('span', null, h('i', { className: 'dot due' }), '待复习'),
    h('span', null, h('i', { className: 'dot done' }), '已完成'),
    h('span', null, h('i', { className: 'dot late' }), '逾期')
  ));
  row1.appendChild(cal);

  // ----- 记录 -----
  row1.appendChild(recordPanel(diff, dayTag));

  // ----- 复习强度图（外壳先放好，等整个界面放进页面、量得出宽高之后再画）-----
  const zoomBtn = (label, text, fk, fn) => h('button', { type: 'button', className: 'mini-btn', 'aria-label': label, title: label, 'data-fk': fk, onclick: fn }, text);
  row1.appendChild(h('div', { className: 'sheet load' },
    h('div', { className: 'fill', 'data-sk': 'load' },
      h('div', { className: 'block-head' },
        h('h3', null, '复习强度'),
        h('span', { className: 'chart-tools' },
          zoomBtn('缩小：看更多天', '－', 'zoom-out', () => { zoomChartX(1.4, 0.5); redrawChart(); }),
          zoomBtn('放大：看更少天', '＋', 'zoom-in', () => { zoomChartX(1 / 1.4, 0.5); redrawChart(); }),
          zoomBtn('回到日历上的这个月', '复位', 'zoom-reset', () => { resetChart(); redrawChart(); }))),
      h('p', { className: 'load-stat', id: 'load-stat' }),
      h('div', { className: 'load-plot', id: 'load-plot' }),
      h('p', { className: 'load-note' }, '强度 = 当天完成的复习 ÷ 当天应该复习的，没复习就是 0。在图上滚动滚轮可以缩放天数，按住 Shift 再滚是缩放纵轴，按住拖动可以左右移动，点某一天可以选中它。')
    )));

  // ----- 需要复习 -----
  const doneCount = dayReviews.filter(r => isCompleted(selKey, r.content, r.learnedOn)).length;
  const revList = h('div', { className: 'list' });
  if (dayReviews.length === 0) revList.appendChild(h('p', { className: 'empty' }, '这一天没有要复习的内容。'));
  if (diff < 0 && doneCount < dayReviews.length) revList.appendChild(h('p', { className: 'block-note late' }, '这一天已经过去了。补上之后照常打勾就行。'));
  groupByLearned(dayReviews).forEach(g => {
    revList.appendChild(groupHead(g));
    g.items.forEach(r => revList.appendChild(checkRow('day', selKey, r)));
  });
  row2.appendChild(h('div', { className: 'sheet block reviews' },
    h('div', { className: 'block-head' },
      h('h3', null, '需要复习', dayTag()),
      h('span', { className: 'count' }, dayReviews.length ? '已完成 ' + doneCount + ' / ' + dayReviews.length : '')),
    revList));

  // ----- 这一天学的 -----
  const learnList = h('div', { className: 'list' });
  if (dayLearned.length === 0) learnList.appendChild(h('p', { className: 'empty' }, '这一天还没有记内容。写在上面的输入框里，六次复习会自动排进日历。'));
  dayLearned.forEach((item, idx) => {
    // 六个小圆点：这条内容的六次复习各自的进度
    const pips = REVIEW_INTERVALS.map(interval => {
      const rd = addDays(state.selectedDate, interval);
      const st = isCompleted(dateToKey(rd), item, selKey) ? 'done' : rd < today ? 'late' : sameDay(rd, today) ? 'due' : 'todo';
      return h('i', { className: 'pip ' + st });
    });
    const doneN = REVIEW_INTERVALS.filter(n => isCompleted(dateToKey(addDays(state.selectedDate, n)), item, selKey)).length;
    learnList.appendChild(h('div', { className: 'item learn-item' },
      h('span', { className: 'item-text' }, item),
      h('span', { className: 'pips', role: 'img', 'aria-label': '六次复习已完成 ' + doneN + ' 次', title: '六次复习已完成 ' + doneN + ' 次' }, pips),
      h('button', { type: 'button', className: 'del-btn', 'aria-label': '删除：' + item, 'data-fk': 'del:' + idx, onclick: () => deleteEntry(selKey, idx) }, icon('close'))
    ));
  });
  if (dayLearned.length > 0) {
    // 复习安排：点日期可以直接跳过去
    learnList.appendChild(h('p', { className: 'plan-label' }, '这些内容的复习日（点一下可以跳过去）：'));
    learnList.appendChild(h('div', { className: 'plan' }, REVIEW_INTERVALS.map((interval, i) => {
      const rd = addDays(state.selectedDate, interval);
      const rk = dateToKey(rd);
      const mine = (rMap[rk] || []).filter(r => r.learnedOn === selKey);
      const allDone = mine.length > 0 && mine.every(r => isCompleted(rk, r.content, r.learnedOn));
      const st = allDone ? 'done' : rd < today ? 'late' : sameDay(rd, today) ? 'due' : 'todo';
      return h('button', { type: 'button', className: 'plan-chip ' + st, 'data-fk': 'plan:' + i, onclick: () => goToDate(rd) },
        h('b', null, fmtShort(rd)), h('span', null, '第 ' + (i + 1) + ' 次'));
    })));
  }
  row2.appendChild(h('div', { className: 'sheet block learned' },
    h('div', { className: 'block-head' },
      h('h3', null, diff === 0 ? '今天学的' : '这一天学的', diff === 0 ? null : dayTag()),
      h('span', { className: 'count' }, dayLearned.length ? dayLearned.length + ' 项' : '')),
    learnList));

  // ---------- 弹窗 ----------
  if (state.dialog) app.appendChild(dialogNode({ today, todayKey, todayRevs, todayDone, streak, totalLearned, totalDone }));

  // 界面已经在页面里了，现在量得出大小：把每个科目框调到合适的高度，再画复习强度图
  app.querySelectorAll('.sbox textarea').forEach(autoGrow);
  drawLoadChart(rMap, today);

  // 恢复滚动位置和键盘焦点
  window.scrollTo(0, scrollY);
  app.querySelectorAll('[data-sk]').forEach(el => { if (scrolls[el.dataset.sk]) el.scrollTop = scrolls[el.dataset.sk]; });
  if (focusKey) {
    const el = app.querySelector('[data-fk="' + (window.CSS && CSS.escape ? CSS.escape(focusKey) : focusKey) + '"]');
    if (el && !el.disabled) {
      el.focus({ preventScroll: true });
      try { if (caret && el.setSelectionRange) el.setSelectionRange(caret[0], caret[1]); } catch (e) {}
    }
  }
}

// 让输入框的高度跟着内容走：空的时候 2 行，写多了就变高，最高 12 行
function autoGrow(ta) {
  ta.style.height = 'auto';
  const h2 = Math.min(Math.max(ta.scrollHeight, LINE_H * 2), LINE_H * MAX_LINES);
  ta.style.height = (h2 + 1) + 'px';          // +1 是下边框的那 1 像素
}

// 记录那一栏：一个科目就是一个小框。框里是名字和输入框，最下面是“新建”按钮
function recordPanel(diff, dayTag) {
  const subjects = state.settings.subjects;
  const addBtn = h('button', { type: 'button', className: 'btn add-btn', 'data-fk': 'add', disabled: !hasInput(), onclick: addEntries }, '添加到 ' + fmtDate(state.selectedDate));
  const body = h('div', { className: 'record-body', 'data-sk': 'record' });

  subjects.forEach((s, i) => {
    const counter = h('span', { className: 'box-count' });
    const showCount = () => {
      const n = (state.boxText[i] || '').split('\n').length;
      const used = (state.boxText[i] || '').trim() ? n : 0;
      counter.textContent = used ? used + ' / ' + MAX_LINES + ' 行' : '';
      counter.classList.toggle('full', used >= MAX_LINES);
    };
    const ta = h('textarea', {
      rows: '2', 'data-fk': 'box:' + i,
      'aria-label': ((s.name || '').trim() || '第 ' + (i + 1) + ' 个框') + '的学习内容，每行一个知识点',
      placeholder: i === 0 ? '每行写一个知识点' : '',
      oninput: e => {
        // 最多 12 行：多出来的行直接去掉
        let v = e.target.value;
        const parts = v.split('\n');
        if (parts.length > MAX_LINES) {
          const pos = e.target.selectionStart;
          v = parts.slice(0, MAX_LINES).join('\n');
          e.target.value = v;
          e.target.setSelectionRange(Math.min(pos, v.length), Math.min(pos, v.length));
        }
        state.boxText[i] = v;
        autoGrow(e.target); showCount();
        addBtn.disabled = !hasInput();
      },
      onkeydown: e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addEntries(); } }
    });
    ta.value = state.boxText[i] || '';
    showCount();

    body.appendChild(h('div', { className: 'sbox' },
      h('div', { className: 'box-head' },
        h('input', {
          type: 'text', className: 'box-name', maxlength: '12', value: s.name, 'data-fk': 'box-name:' + i,
          placeholder: '点这里起名字，比如' + ['英语', '数学', '专业课'][i % 3],
          'aria-label': '第 ' + (i + 1) + ' 个框的名字',
          // 打字时只保存，不重画（重画会打断输入）
          oninput: e => { s.name = e.target.value; saveSettings(); }
        }),
        counter,
        subjects.length > 1 ? h('button', { type: 'button', className: 'box-del', 'aria-label': '删掉这个框', title: '删掉这个框', 'data-fk': 'box-del:' + i, onclick: () => removeBox(i) }, icon('close')) : null),
      ta));
  });

  // 坚持项的框：排在科目框后面
  state.habits.forEach(hb => body.appendChild(habitBox(hb, diff)));

  // 加号按钮：新建一个科目框，最多 12 个
  body.appendChild(subjects.length < MAX_BOXES
    ? h('button', { type: 'button', className: 'box-add', 'data-fk': 'box-add', 'aria-label': '新建一个科目框', onclick: addBox }, icon('plus'), '新建一个科目框')
    : h('p', { className: 'box-limit' }, '已经有 ' + MAX_BOXES + ' 个科目框了，这是上限。'));
  // 它下面：新建一个坚持项，最多 12 个
  body.appendChild(state.habits.length < MAX_HABITS
    ? h('button', { type: 'button', className: 'box-add habit-add', 'data-fk': 'habit-add', 'aria-label': '新建一个坚持项', onclick: addHabit }, icon('plus'), '新建一个坚持项')
    : h('p', { className: 'box-limit' }, '已经有 ' + MAX_HABITS + ' 个坚持项了，这是上限。'));

  return h('div', { className: 'sheet record' },
    h('div', { className: 'fill' },
      h('div', { className: 'block-head' },
        h('h3', null, diff === 0 ? '记下今天学的' : '记到', diff === 0 ? null : dayTag()),
        h('span', { className: 'count' }, '每行一个知识点')),
      body,
      h('div', { className: 'add-row' }, addBtn, h('span', { className: 'kbd-hint' }, 'Ctrl + Enter'))
    ));
}

// 一个坚持项的框：名字 + ON/OFF 开关，下面是打卡按钮和连续天数。双击这个框是删除
function habitBox(hb, diff) {
  const selKey = dateToKey(state.selectedDate);
  const checked = habitChecked(hb.id, selKey);
  const canCheck = hb.on && diff <= 0;            // 停止了的、还没到的日子，都不能打卡
  const streak = habitStreak(hb.id), total = habitTotal(hb.id);
  const dayWord = diff === 0 ? '今天' : fmtDate(state.selectedDate);
  return h('div', {
    className: 'hbox' + (hb.on ? '' : ' off'), title: '双击这个框可以删除这个坚持项',
    // 双击的是名字、开关或打卡按钮时不算（那是在改名字或点按钮）
    ondblclick: e => { if (e.target.closest('input,button')) return; askDeleteHabit(hb.id); }
  },
    h('div', { className: 'box-head' },
      h('input', {
        type: 'text', className: 'box-name', maxlength: '16', value: hb.name, 'data-fk': 'habit-name:' + hb.id,
        placeholder: '给坚持项起个名字，比如背英语单词', 'aria-label': '坚持项的名字',
        oninput: e => { hb.name = e.target.value; saveHabits(); }      // 打字时只保存，不重画
      }),
      // ON/OFF 开关：ON 是还在坚持，OFF 是停止
      h('button', {
        type: 'button', role: 'switch', 'aria-checked': String(hb.on), className: 'switch' + (hb.on ? ' on' : ''),
        'aria-label': habitLabel(hb) + (hb.on ? '：还在坚持，点一下停止' : '：已经停止，点一下继续'),
        'data-fk': 'habit-on:' + hb.id, onclick: () => toggleHabitOn(hb.id)
      }, h('span', { className: 'switch-text' }, hb.on ? 'ON' : 'OFF'), h('span', { className: 'switch-knob', 'aria-hidden': 'true' }))),
    h('div', { className: 'habit-row' },
      h('button', {
        type: 'button', role: 'checkbox', 'aria-checked': String(checked), className: 'habit-check' + (checked ? ' is-done' : ''),
        disabled: !canCheck, 'data-fk': 'habit-check:' + hb.id, onclick: () => toggleHabitCheck(hb.id, selKey)
      }, h('span', { className: 'box', 'aria-hidden': 'true' }), checked ? dayWord + '已打卡' : diff > 0 ? '还没到这一天' : dayWord + '打卡'),
      h('span', { className: 'habit-stat' }, hb.on ? (streak ? '已连续 ' + streak + ' 天，累计 ' + total + ' 天' : '累计 ' + total + ' 天') : '已停止，累计 ' + total + ' 天')),
    h('p', { className: 'habit-hint' }, '双击这个框可以删除')
  );
}

// ---------- 复习强度图 ----------
// 横轴是一天一天的日期，纵轴是“强度”= 当天完成的复习 ÷ 当天应该复习的（0 到 100%）。
// 每天一根柱子，再用一条平滑的曲线把柱子顶连起来。滚轮可以缩放。

// 回到日历上显示的那个月
function resetChart() {
  const y = state.currentYear, m = state.currentMonth;
  state.chart = { start: new Date(y, m, 1), days: new Date(y, m + 1, 0).getDate(), yTop: 1, month: y + '-' + m };
}

// 横向缩放：factor > 1 是缩小（看更多天），< 1 是放大。anchor 是鼠标在图上的位置（0 最左，1 最右），
// 缩放时鼠标指着的那一天保持不动
function zoomChartX(factor, anchor) {
  const c = state.chart;
  let n = Math.round(c.days * factor);
  if (n === c.days) n += factor > 1 ? 1 : -1;
  n = Math.min(CHART_MAX_DAYS, Math.max(CHART_MIN_DAYS, n));
  c.start = addDays(c.start, Math.round(anchor * (c.days - n)));
  c.days = n;
}
// 纵向缩放：纵轴最高到 100%，最多放大到只看 0 ~ 10%
function zoomChartY(factor) {
  const c = state.chart;
  c.yTop = Math.min(1, Math.max(0.1, Math.round(c.yTop * factor * 100) / 100));
}
function redrawChart() { drawLoadChart(getReviewMap(), startOfToday()); }

// 把一串点连成平滑的曲线（单调三次插值：曲线不会冲到柱子顶的上面或 0 的下面）
function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], q = a * a + b * b;
    if (q > 9) { const t = 3 / Math.sqrt(q); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let path = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], k = (x1 - x0) / 3;
    path += 'C' + (x0 + k).toFixed(1) + ',' + (y0 + m[i] * k).toFixed(1) + ' ' + (x1 - k).toFixed(1) + ',' + (y1 - m[i + 1] * k).toFixed(1) + ' ' + x1.toFixed(1) + ',' + y1.toFixed(1);
  }
  return path;
}

const CHART_PAD = { left: 40, right: 8, top: 16, bottom: 24 };   // 图四周留给刻度文字的空白

function drawLoadChart(rMap, today) {
  const box = document.getElementById('load-plot');
  if (!box) return;
  const W = box.clientWidth, H = box.clientHeight;
  if (W < 80 || H < 80) return;
  const c = state.chart, N = c.days;
  const { left, right, top: padTop, bottom } = CHART_PAD;
  const plotW = W - left - right, plotH = H - padTop - bottom;
  const colW = plotW / N;                                        // 每一天占的宽度
  const x = i => left + colW * (i + 0.5);
  const y = v => padTop + plotH * (1 - v / c.yTop);
  const f = n => n.toFixed(1);

  const days = [];
  for (let i = 0; i < N; i++) {
    const date = addDays(c.start, i);
    const load = dayLoad(rMap, date, today);
    days.push({ i, date, ...load, ratio: load.total ? load.done / load.total : 0 });   // 强度：完成 ÷ 应复习；没有要复习的就是 0
  }

  let svg = '<defs><clipPath id="plot-clip"><rect x="' + left + '" y="' + (padTop - 4) + '" width="' + f(plotW) + '" height="' + f(plotH + 4) + '"/></clipPath></defs>';
  // 纵轴：分成四格
  for (let k = 0; k <= 4; k++) {
    const v = c.yTop * k / 4, pct = v * 100;
    svg += '<line class="l-grid" x1="' + left + '" x2="' + (W - right) + '" y1="' + f(y(v)) + '" y2="' + f(y(v)) + '"/>' +
           '<text class="l-ylab" x="' + (left - 6) + '" y="' + f(y(v) + 4) + '" text-anchor="end">' + (Number.isInteger(pct) ? pct : pct.toFixed(1)) + '%</text>';
  }
  // 今天：一道荧光笔；选中的那一天：一条蓝色虚线
  days.forEach(p => {
    if (sameDay(p.date, today)) svg += '<rect class="l-today" x="' + f(x(p.i) - colW / 2) + '" y="' + padTop + '" width="' + f(colW) + '" height="' + f(plotH) + '"/>';
    if (sameDay(p.date, state.selectedDate)) svg += '<line class="l-sel" x1="' + f(x(p.i)) + '" x2="' + f(x(p.i)) + '" y1="' + padTop + '" y2="' + f(y(0)) + '"/>';
  });

  // 柱子：越放大越宽。颜色和日历圆点一致（全部完成=绿，过期没做完=红，其余=黄）
  const barW = Math.max(1, Math.min(colW * 0.64, 56));
  let bars = '';
  days.forEach(p => {
    const tip = '<title>' + fmtDate(p.date) + '：' + (p.total ? '完成 ' + p.done + ' / 应复习 ' + p.total + '，强度 ' + Math.round(p.ratio * 100) + '%' : '没有要复习的，强度 0') + '</title>';
    if (p.ratio > 0) bars += '<rect class="l-bar ' + p.state + '" x="' + f(x(p.i) - barW / 2) + '" y="' + f(y(p.ratio)) + '" width="' + f(barW) + '" height="' + f(y(0) - y(p.ratio)) + '">' + tip + '</rect>';
    // 有要复习的但一项都没做：在 0 的位置点一个小圆点，和“本来就没有要复习的”区分开
    else if (p.total) bars += '<circle class="l-zero ' + p.state + '" cx="' + f(x(p.i)) + '" cy="' + f(y(0)) + '" r="' + f(Math.max(1.5, Math.min(3.2, colW * 0.3))) + '">' + tip + '</circle>';
  });
  // 曲线：把每天的顶点连起来。线的粗细也跟着缩放变
  const lineW = Math.max(1.2, Math.min(3, colW / 9));
  const curve = '<path class="l-line" style="stroke-width:' + f(lineW) + '" d="' + smoothPath(days.map(p => [x(p.i), y(p.ratio)])) + '"/>';
  svg += '<g clip-path="url(#plot-clip)">' + bars + curve + '</g>';

  // 放得够大时，在柱子上方写出具体的量：完成几项 / 应复习几项
  if (colW >= 30) days.forEach(p => {
    if (p.total) svg += '<text class="l-val" x="' + f(x(p.i)) + '" y="' + f(Math.max(padTop - 4, y(Math.min(p.ratio, c.yTop)) - 5)) + '" text-anchor="middle">' + p.done + '/' + p.total + '</text>';
  });

  // 横轴日期：隔几天标一个，保证文字不挤在一起。每月 1 号和第一个标签写成“月/日”
  const stepX = [1, 2, 5, 7, 10, 15, 30, 60].find(st => st * colW >= 34) || 60;
  let firstLabel = true;
  days.forEach(p => {
    const dd = p.date.getDate();
    const show = stepX === 1 || (stepX >= 30 ? dd === 1 : dd === 1 || (dd % stepX === 0 && dd < 29));
    if (!show) return;
    svg += '<text class="l-xlab" x="' + f(x(p.i)) + '" y="' + (H - 6) + '" text-anchor="middle">' + (dd === 1 || firstLabel ? fmtShort(p.date) : dd) + '</text>';
    firstLabel = false;
  });

  const label = '复习强度图，从 ' + fmtDate(days[0].date) + ' 到 ' + fmtDate(days[N - 1].date) + '，每天一根柱子，高度是当天完成的复习占应复习的比例。';
  box.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + label + '">' + svg + '</svg>';

  // 图上方的一句话：这段时间整体完成得怎么样（只算到今天为止）
  const past = days.filter(p => p.date <= today && p.total);
  const need = past.reduce((a, p) => a + p.total, 0), did = past.reduce((a, p) => a + p.done, 0);
  const stat = document.getElementById('load-stat');
  if (stat) stat.textContent = fmtShort(days[0].date) + ' 到 ' + fmtShort(days[N - 1].date) + '，共 ' + N + ' 天。' +
    (need ? '到今天为止应复习 ' + need + ' 项，完成 ' + did + ' 项，整体强度 ' + Math.round(did / need * 100) + '%。' : '到今天为止没有要复习的内容。');

  bindChart(box);
}

// 给图装上滚轮缩放、拖动、点击。每个图只装一次
function bindChart(box) {
  if (box.dataset.bound) return;
  box.dataset.bound = '1';
  const pos = e => {                       // 鼠标在图里的位置：frac 是横向 0~1，inAxis 表示在左边的纵轴刻度上
    const r = box.getBoundingClientRect();
    const px = e.clientX - r.left;
    return { px, frac: Math.min(1, Math.max(0, (px - CHART_PAD.left) / (r.width - CHART_PAD.left - CHART_PAD.right))), inAxis: px < CHART_PAD.left, width: r.width };
  };

  // 滚轮：默认缩放天数；按住 Shift，或鼠标停在左边的百分比刻度上，就缩放纵轴
  box.addEventListener('wheel', e => {
    e.preventDefault();                    // 不让页面跟着滚
    const delta = e.deltaY || e.deltaX;    // 有的浏览器按住 Shift 时会把滚动变成横向的
    if (!delta) return;
    const p = pos(e);
    if (e.shiftKey || p.inAxis) zoomChartY(delta > 0 ? 1.25 : 0.8);
    else zoomChartX(delta > 0 ? 1.25 : 0.8, p.frac);
    redrawChart();
  }, { passive: false });

  // 按住拖动：左右移动；没怎么动就算点击：选中那一天
  let drag = null;
  box.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    drag = { x: e.clientX, start: state.chart.start, moved: false };
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (!drag.moved) return;
    const colW = (pos(e).width - CHART_PAD.left - CHART_PAD.right) / state.chart.days;
    const next = addDays(drag.start, -Math.round(dx / colW));
    if (!sameDay(next, state.chart.start)) { state.chart.start = next; redrawChart(); }
  });
  const end = e => {
    if (!drag) return;
    const wasClick = !drag.moved && e.type === 'pointerup';
    drag = null;
    if (!wasClick) return;
    const p = pos(e);
    if (p.inAxis) return;
    const d = addDays(state.chart.start, Math.min(state.chart.days - 1, Math.floor(p.frac * state.chart.days)));
    // 选中这一天，日历也翻到它所在的月份；图保持现在的缩放不变
    state.selectedDate = d; state.currentYear = d.getFullYear(); state.currentMonth = d.getMonth();
    state.chart.month = state.currentYear + '-' + state.currentMonth;
    render();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}

// 三种弹窗共用一个外壳
function dialogNode(ctx) {
  let title, sub = '', body = [], foot = null;

  if (state.dialog === 'summary') {
    title = '今日复习摘要';
    sub = ctx.today.getFullYear() + '年' + fmtDate(ctx.today) + ' 周' + WEEKDAYS[ctx.today.getDay()];
    const stillLate = state.overdueShot.filter(r => !isCompleted(r.dueDate, r.content, r.learnedOn)).length;
    if (ctx.streak > 0) {
      const s = ctx.streak;
      body.push(h('p', { className: 'streak-line' }, '已经连续坚持 ', h('b', null, s), ' 天。',
        s >= 30 ? '一个月了，真厉害。' : s >= 14 ? '两周了，继续保持。' : s >= 7 ? '满一周了。' : '加油。'));
    }
    body.push(h('div', { className: 'summary-nums' },
      h('div', null, h('b', null, ctx.todayRevs.length), h('span', null, '今日要复习')),
      h('div', { className: 'done' }, h('b', null, ctx.todayDone), h('span', null, '已完成')),
      h('div', { className: stillLate ? 'late' : 'done' }, h('b', null, stillLate), h('span', null, '逾期未复习'))
    ));
    body.push(h('p', { className: 'dialog-text' }, '累计：已学 ' + ctx.totalLearned + ' 项内容，学了 ' + Object.keys(state.entries).length + ' 天，完成复习 ' + ctx.totalDone + ' 次。'));
    if (ctx.todayRevs.length > 0) {
      body.push(h('h3', null, '今天的清单'));
      groupByLearned(ctx.todayRevs).forEach(g => {
        body.push(groupHead(g));
        g.items.forEach(r => body.push(checkRow('dlg', ctx.todayKey, r)));
      });
    } else {
      body.push(h('p', { className: 'dialog-text' }, '今天没有排到要复习的内容。'));
    }
    const act = activeHabits();
    if (act.length > 0) {
      body.push(h('h3', null, '坚持项'));
      act.forEach(hb => {
        const ok = habitChecked(hb.id, ctx.todayKey), st = habitStreak(hb.id);
        body.push(h('button', {
          type: 'button', role: 'checkbox', 'aria-checked': String(ok), className: 'item check-item' + (ok ? ' is-done' : ''),
          'data-fk': 'dlg-habit:' + hb.id, onclick: () => toggleHabitCheck(hb.id, ctx.todayKey)
        }, h('span', { className: 'box', 'aria-hidden': 'true' }), h('span', { className: 'item-text' }, habitLabel(hb)),
          h('span', { className: 'item-meta' }, st ? '连续 ' + st + ' 天' : '今天还没打卡')));
      });
    }
    if (state.overdueShot.length > 0) {
      body.push(h('h3', { className: 'late' }, '逾期未复习'));
      body.push(h('p', { className: 'dialog-text' }, '这些已经过了复习日。补上之后在这里打勾就行。'));
      state.overdueShot.forEach(r => body.push(checkRow('dlg', r.dueDate, r, '原定 ' + fmtShort(keyToDate(r.dueDate)))));
    }
    foot = h('button', { type: 'button', className: 'btn', onclick: closeDialog }, ctx.todayRevs.length - ctx.todayDone > 0 ? '开始复习' : '知道了');
  }

  // “再次询问”：删除坚持项之前问一句
  if (state.dialog === 'confirm' && state.confirm) {
    const hb = state.habits.find(x => x.id === state.confirm.id);
    title = '再次询问';
    body.push(h('p', { className: 'confirm-text' }, '确定要删除坚持项“' + (hb ? habitLabel(hb) : '') + '”吗？'));
    body.push(h('p', { className: 'dialog-text' }, '它的 ' + (hb ? habitTotal(hb.id) : 0) + ' 天打卡记录也会一起删除，删了就找不回来。只是暂时不做的话，把开关拨到 OFF 就行。'));
    foot = [
      h('button', { type: 'button', className: 'btn danger', 'data-fk': 'confirm-yes', onclick: () => deleteHabit(state.confirm.id) }, '确定'),
      h('button', { type: 'button', className: 'btn ghost', 'data-fk': 'confirm-no', onclick: closeDialog }, '再想想')
    ];
  }

  if (state.dialog === 'overdue') {
    title = '逾期未复习';
    sub = '已经过了复习日、还没打勾的内容';
    if (state.overdueShot.length === 0) body.push(h('p', { className: 'dialog-text' }, '没有逾期的内容。'));
    // 按“原定哪天复习”分组
    const byDue = {};
    state.overdueShot.forEach(r => { (byDue[r.dueDate] = byDue[r.dueDate] || []).push(r); });
    Object.keys(byDue).sort().forEach(dk => {
      const d = keyToDate(dk);
      body.push(h('div', { className: 'group-head' },
        h('span', null, '原定 ' + fmtDate(d) + ' 复习'),
        h('button', { type: 'button', className: 'link-btn', onclick: () => { state.dialog = null; goToDate(d); } }, '去这一天')));
      byDue[dk].forEach(r => body.push(checkRow('dlg', dk, r, '第 ' + r.reviewRound + ' 次')));
    });
    foot = h('button', { type: 'button', className: 'btn', onclick: closeDialog }, '完成');
  }

  if (state.dialog === 'data') {
    title = '备份';
    sub = '记录只存在这台设备的这个浏览器里';
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', className: 'file-input', onchange: e => { if (e.target.files[0]) importBackup(e.target.files[0]); } });
    body.push(h('p', { className: 'dialog-text' }, '现在这里有 ' + ctx.totalLearned + ' 项学习内容、' + ctx.totalDone + ' 条完成记录。清除浏览器数据或换设备之前，先导出一份。'));
    body.push(h('div', { className: 'set-row' },
      h('div', null, h('strong', null, '导出备份'), h('p', null, '把全部记录存成一个文件，下载到这台设备。')),
      h('button', { type: 'button', className: 'btn', 'data-fk': 'export', disabled: ctx.totalLearned === 0, onclick: exportBackup }, '导出')));
    body.push(h('div', { className: 'set-row' },
      h('div', null, h('strong', null, '导入备份'), h('p', null, '从备份文件里把记录加回来。只会添加，不会删掉这里已有的内容。')),
      h('button', { type: 'button', className: 'btn ghost', 'data-fk': 'import', onclick: () => fileInput.click() }, '选择文件'),
      fileInput));
    if (state.dataMsg) body.push(h('p', { className: 'data-msg', role: 'status' }, state.dataMsg));
  }

  const fresh = state.dialogFresh; state.dialogFresh = false;
  return h('div', { className: 'overlay' + (fresh ? ' fresh' : ''), onclick: closeDialog },
    h('div', { className: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title', onclick: e => e.stopPropagation() },
      h('header', { className: 'dialog-head' },
        h('div', null, h('h2', { id: 'dialog-title' }, title), sub ? h('p', null, sub) : null),
        h('button', { type: 'button', className: 'dialog-close', 'aria-label': '关闭', 'data-fk': 'dialog-close', onclick: closeDialog }, icon('close'))),
      h('div', { className: 'dialog-body', 'data-sk': 'dialog' }, body),
      foot ? h('footer', { className: 'dialog-foot' + (Array.isArray(foot) ? ' two' : '') }, foot) : null
    )
  );
}

// ========== 5) 启动 ==========
loadState();

// 按 Esc 关闭弹窗
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.dialog) closeDialog(); });

// 窗口宽度变了（比如手机横过来），复习强度图要按新的大小重画
let lastWidth = window.innerWidth, resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; render(); } }, 150);
});

// 打开时：今天有要复习的、有逾期的，或者有还没打卡的坚持项，而且这次打开还没看过摘要，就自动弹出今日摘要
(function start() {
  const todayKey = dateToKey(startOfToday());
  const rMap = getReviewMap();
  let seen = false;
  try { seen = sessionStorage.getItem(SS_DISMISSED) === todayKey; } catch (e) {}
  const habitsLeft = activeHabits().some(hb => !habitChecked(hb.id, todayKey));     // 今天还有没打卡的坚持项
  if (!seen && ((rMap[todayKey] || []).length > 0 || getOverdue(rMap).length > 0 || habitsLeft)) openDialog('summary');
  else render();
})();
