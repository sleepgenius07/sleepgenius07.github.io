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
// 存“记录方式”设置用的名字（每天记几门、每门记几个）
const LS_SETTINGS = 'ebbinghaus-settings-v1';
// 记住“今天的摘要已经看过了”，只在这次打开期间有效（关掉标签页就忘）
const SS_DISMISSED = 'ebbinghaus-summary-dismissed';
const MAX_SUBJECTS = 8;      // 最多分几门
const MAX_PER_SUBJECT = 20;  // 每门最多定几个

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
  // 记录方式： subjects 是每天要记的几门，每门有名字和打算记的个数。
  // 例： [ {name:'英语', count:5}, {name:'数学', count:3} ]。空数组 = 不分科目，随便写
  settings: { subjects: [] },
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  selectedDate: startOfToday(),
  inputText: '',      // 不分科目时，输入框里的字
  subjectText: {},    // 分科目时，每一门输入框里的字： { 0:'...', 1:'...' }
  dialog: null,       // 现在打开的弹窗：null / 'summary' 今日摘要 / 'overdue' 逾期清单 / 'settings' 设置
  dialogFresh: false, // 弹窗是不是刚打开（刚打开时播放一次出现的动画）
  overdueShot: [],    // 打开弹窗那一刻的逾期清单（这样打了勾的条目不会马上从眼前消失）
  dataMsg: ''         // 设置弹窗里，备份的结果提示
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
}
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ entries: state.entries, completed: state.completed }));
  } catch (e) {}
}
function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch (e) {}
}
// 检查一遍科目设置，防止读到坏数据
function cleanSubjects(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SUBJECTS).map(s => ({
    name: typeof (s && s.name) === 'string' ? s.name.slice(0, 12) : '',
    count: Math.min(MAX_PER_SUBJECT, Math.max(1, parseInt(s && s.count, 10) || 5))
  }));
}
// 第 i 门的名字：没起名字就叫“第 N 门”
function subjectName(i) { return (state.settings.subjects[i].name || '').trim() || '第 ' + (i + 1) + ' 门'; }

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

// 输入框里现在有没有写东西
function hasInput() {
  if (state.settings.subjects.length === 0) return !!state.inputText.trim();
  return state.settings.subjects.some((_, i) => (state.subjectText[i] || '').trim());
}

// 把输入框里的内容加到选中的那一天。
// 分了科目时，每条前面自动加上“科目名：”，例如在“英语”那一门里写 abandon，存成“英语：abandon”
function addEntries() {
  const subjects = state.settings.subjects;
  let lines = [];
  if (subjects.length === 0) lines = toLines(state.inputText);
  else subjects.forEach((_, i) => {
    const name = subjectName(i);
    toLines(state.subjectText[i]).forEach(l => lines.push(l.startsWith(name + '：') || l.startsWith(name + ':') ? l : name + '：' + l));
  });
  if (!lines.length) return;
  const k = dateToKey(state.selectedDate);
  if (!state.entries[k]) state.entries[k] = [];
  lines.forEach(l => state.entries[k].push(l));
  state.inputText = ''; state.subjectText = {};
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

// --- 记录方式：每天记几门、每门记几个 ---
function setSubjectCount(n) {
  const list = state.settings.subjects;
  n = Math.min(MAX_SUBJECTS, Math.max(0, n));
  while (list.length < n) list.push({ name: '', count: 5 });
  while (list.length > n) list.pop();
  saveSettings(); render();
}
function setSubjectTarget(i, n) {
  state.settings.subjects[i].count = Math.min(MAX_PER_SUBJECT, Math.max(1, n));
  saveSettings(); render();
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
  render();
}

// --- 备份：导出成一个文件 / 从文件导入 ---
function exportBackup() {
  const data = { app: 'ebbinghaus-review', version: 1, exportedAt: new Date().toISOString(), entries: state.entries, completed: state.completed, settings: state.settings };
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
      // 记录方式：这台设备还没设过，才用备份里的
      if (state.settings.subjects.length === 0 && d.settings) {
        state.settings.subjects = cleanSubjects(d.settings.subjects);
        saveSettings();
      }
      state.dataMsg = added || ticks
        ? '导入完成：新增 ' + added + ' 项学习内容、' + ticks + ' 条完成记录。'
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
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', close: 'M6 6l12 12M18 6L6 18', minus: 'M6 12h12', plus: 'M6 12h12M12 6v12'
};
function icon(name) {
  const s = h('span', { className: 'icon', 'aria-hidden': 'true' });
  s.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="' + ICONS[name] + '"/></svg>';
  return s;
}

// 加减按钮： [−] 3 [+]
function stepper(value, min, max, onChange, label, fk) {
  return h('span', { className: 'stepper', role: 'group', 'aria-label': label },
    h('button', { type: 'button', 'aria-label': label + '减 1', disabled: value <= min, 'data-fk': fk + '-', onclick: () => onChange(value - 1) }, icon('minus')),
    h('b', { 'aria-live': 'polite' }, value),
    h('button', { type: 'button', 'aria-label': label + '加 1', disabled: value >= max, 'data-fk': fk + '+', onclick: () => onChange(value + 1) }, icon('plus')));
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
  if (todayRevs.length === 0) line = totalLearned === 0 ? '还没有记录。写下今天学的内容，复习日程会自动排好。' : '今天没有要复习的内容。';
  else if (todayLeft === 0) line = '今天的 ' + todayRevs.length + ' 项都复习完了。';
  else line = '今天要复习 ' + todayRevs.length + ' 项，已完成 ' + todayDone + ' 项。';

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
        h('button', { type: 'button', className: 'chip', 'data-fk': 'open-settings', onclick: () => openDialog('settings') }, '设置')
      )
    ),
    // 今日复习进度：贴在这一栏最下面的一条细线
    todayRevs.length > 0 ? h('div', { className: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(todayRevs.length), 'aria-valuenow': String(todayDone), 'aria-label': '今日复习进度' },
      h('div', { className: 'progress-fill' + (todayLeft === 0 ? ' full' : ''), style: { width: (todayDone / todayRevs.length * 100) + '%' } })) : null
  ));

  // ---------- 主体 ----------
  // 第一排三块一样高：日历 | 记录 | 复习强度图。第二排两块：需要复习 | 这一天学的
  const row1 = h('div', { className: 'row1' });
  const row2 = h('div', { className: 'row2' });
  app.appendChild(h('div', { className: 'workspace' }, row1, row2));

  // ----- 日历 -----
  const cal = h('div', { className: 'sheet cal' });
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
  row1.appendChild(recordPanel(dayLearned, diff, dayTag));

  // ----- 复习强度图（外壳先放好，等整个界面放进页面、量得出宽高之后再画线）-----
  row1.appendChild(h('div', { className: 'sheet load' },
    h('div', { className: 'fill' },
      h('div', { className: 'block-head' },
        h('h3', null, '复习强度'),
        h('span', { className: 'count' }, (state.currentMonth + 1) + '月每天要复习几项')),
      h('div', { className: 'load-plot', id: 'load-plot' }),
      h('p', { className: 'load-note' }, '圆点颜色和日历一样。点图上的某一天，可以选中它。')
    )));

  // ----- 需要复习 -----
  const doneCount = dayReviews.filter(r => isCompleted(selKey, r.content, r.learnedOn)).length;
  const revList = h('div', { className: 'scroll', 'data-sk': 'reviews' });
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
  const learnList = h('div', { className: 'scroll', 'data-sk': 'learned' });
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

  // 界面已经在页面里了，现在量得出大小，可以画复习强度图
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

// 记录面板。不分科目时是一个大输入框；分了科目时，每一门一个输入框，横线的行数就是打算记的个数
function recordPanel(dayLearned, diff, dayTag) {
  const subjects = state.settings.subjects;
  const addBtn = h('button', { type: 'button', className: 'btn add-btn', 'data-fk': 'add', disabled: !hasInput(), onclick: addEntries }, '添加到 ' + fmtDate(state.selectedDate));
  const onKey = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addEntries(); } };
  const body = h('div', { className: 'record-body', 'data-sk': 'record' });
  let headNote;

  if (subjects.length === 0) {
    // --- 不分科目：一个大输入框，占满整块 ---
    headNote = h('span', { className: 'count' }, '每行一个知识点');
    const ta = h('textarea', {
      id: 'learn-input', className: 'big', 'data-fk': 'input', 'aria-label': '学习内容，每行一个知识点',
      placeholder: '每行写一个知识点，例如：\n英语单词：abandon, abolish\n数学：导数的基本公式',
      oninput: e => { state.inputText = e.target.value; addBtn.disabled = !hasInput(); },
      onkeydown: onKey
    });
    ta.value = state.inputText;
    body.appendChild(ta);
  } else {
    // --- 分科目：每一门一个输入框 ---
    const total = subjects.reduce((s, x) => s + x.count, 0);
    headNote = h('span', { className: 'count' });
    const counters = [];
    const refresh = () => {
      let sum = 0;
      subjects.forEach((s, i) => {
        const n = counters[i].saved + toLines(state.subjectText[i]).length;
        sum += n;
        counters[i].el.textContent = n + ' / ' + s.count;
        counters[i].el.classList.toggle('met', n >= s.count);
      });
      headNote.textContent = '共 ' + sum + ' / ' + total;
      addBtn.disabled = !hasInput();
    };
    subjects.forEach((s, i) => {
      const name = subjectName(i);
      // 这一天已经存下来的、属于这一门的条数（以“科目名：”开头的）
      const saved = dayLearned.filter(t => t.startsWith(name + '：') || t.startsWith(name + ':')).length;
      const counter = h('span', { className: 'subject-count', title: '已经记下的 + 正在写的 / 打算记的' });
      counters.push({ el: counter, saved });
      const ta = h('textarea', {
        id: 'subject-' + i, 'data-fk': 'subject:' + i, rows: String(s.count),
        placeholder: '每行一个，共 ' + s.count + ' 个',
        oninput: e => { state.subjectText[i] = e.target.value; refresh(); },
        onkeydown: onKey
      });
      ta.value = state.subjectText[i] || '';
      body.appendChild(h('div', { className: 'subject' },
        h('div', { className: 'subject-head' }, h('label', { for: 'subject-' + i }, name), counter),
        ta));
    });
    refresh();
  }

  return h('div', { className: 'sheet record' },
    h('div', { className: 'fill' },
      h('div', { className: 'block-head' },
        h('h3', null, diff === 0 ? '记下今天学的' : '记到', diff === 0 ? null : dayTag()),
        headNote),
      body,
      h('div', { className: 'add-row' },
        addBtn,
        h('span', { className: 'kbd-hint' }, 'Ctrl + Enter'),
        h('button', { type: 'button', className: 'link-btn', 'data-fk': 'customize', onclick: () => openDialog('settings') }, subjects.length ? '改科目和数量' : '按科目记'))
    ));
}

// 复习强度图：横轴是日历上这个月的每一天，纵轴是那天要复习几项，用折线连起来
function drawLoadChart(rMap, today) {
  const box = document.getElementById('load-plot');
  if (!box) return;
  const W = box.clientWidth, H = box.clientHeight;
  if (W < 80 || H < 80) return;
  const y0 = state.currentYear, m0 = state.currentMonth;
  const nDays = new Date(y0, m0 + 1, 0).getDate();
  const days = [];
  for (let d = 1; d <= nDays; d++) { const date = new Date(y0, m0, d); days.push({ d, date, ...dayLoad(rMap, date, today) }); }

  // 纵轴：最高刻度取一个整齐的数（至少到 4）
  const peak = Math.max(4, ...days.map(x => x.total));
  const stepY = peak <= 4 ? 1 : peak <= 8 ? 2 : peak <= 20 ? 5 : peak <= 40 ? 10 : Math.ceil(peak / 40) * 10;
  const top = Math.ceil(peak / stepY) * stepY;

  const left = 30, right = 10, padTop = 12, bottom = 26;
  const colW = (W - left - right) / nDays;                       // 每一天占的宽度
  const x = d => left + colW * (d - 0.5);
  const y = v => padTop + (H - padTop - bottom) * (1 - v / top);
  const f = n => n.toFixed(1);

  let svg = '';
  for (let v = 0; v <= top; v += stepY) {
    svg += '<line class="l-grid" x1="' + left + '" x2="' + (W - right) + '" y1="' + f(y(v)) + '" y2="' + f(y(v)) + '"/>' +
           '<text class="l-ylab" x="' + (left - 7) + '" y="' + f(y(v) + 4) + '" text-anchor="end">' + v + '</text>';
  }
  // 今天：一道荧光笔；选中的那一天：一条蓝色竖线
  if (today.getFullYear() === y0 && today.getMonth() === m0) {
    svg += '<rect class="l-today" x="' + f(x(today.getDate()) - colW / 2) + '" y="' + padTop + '" width="' + f(colW) + '" height="' + f(H - padTop - bottom) + '"/>';
  }
  const sel = state.selectedDate;
  if (sel.getFullYear() === y0 && sel.getMonth() === m0) {
    svg += '<line class="l-sel" x1="' + f(x(sel.getDate())) + '" x2="' + f(x(sel.getDate())) + '" y1="' + padTop + '" y2="' + f(y(0)) + '"/>';
  }
  // 折线和它下面的浅色
  const pts = days.map(p => f(x(p.d)) + ',' + f(y(p.total)));
  svg += '<path class="l-area" d="M' + f(x(1)) + ',' + f(y(0)) + 'L' + pts.join('L') + 'L' + f(x(nDays)) + ',' + f(y(0)) + 'Z"/>';
  svg += '<path class="l-line" d="M' + pts.join('L') + '"/>';
  // 有复习的日子画一个圆点，颜色和日历上的圆点一致
  days.forEach(p => { if (p.total) svg += '<circle class="l-dot ' + p.state + '" cx="' + f(x(p.d)) + '" cy="' + f(y(p.total)) + '" r="3.6"/>'; });
  // 横轴日期：1、5、10、15……
  days.forEach(p => { if (p.d === 1 || p.d % 5 === 0) svg += '<text class="l-xlab" x="' + f(x(p.d)) + '" y="' + (H - 7) + '" text-anchor="middle">' + p.d + '</text>'; });
  // 每一天一条看不见的竖条，用来接收点击
  days.forEach(p => {
    svg += '<rect class="l-hit" data-d="' + p.d + '" x="' + f(x(p.d) - colW / 2) + '" y="0" width="' + f(colW) + '" height="' + H + '">' +
           '<title>' + fmtDate(p.date) + '：' + (p.total ? '要复习 ' + p.total + ' 项，已完成 ' + p.done + ' 项' : '没有要复习的') + '</title></rect>';
  });

  const busiest = days.reduce((a, b) => (b.total > a.total ? b : a), days[0]);
  const label = (m0 + 1) + '月复习强度折线图。' + (busiest.total ? '最多的一天是 ' + fmtDate(busiest.date) + '，要复习 ' + busiest.total + ' 项。' : '这个月没有要复习的内容。');
  box.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + label + '">' + svg + '</svg>';
  box.querySelectorAll('.l-hit').forEach(r => r.addEventListener('click', () => {
    state.selectedDate = new Date(y0, m0, Number(r.dataset.d)); render();
  }));
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
    if (state.overdueShot.length > 0) {
      body.push(h('h3', { className: 'late' }, '逾期未复习'));
      body.push(h('p', { className: 'dialog-text' }, '这些已经过了复习日。补上之后在这里打勾就行。'));
      state.overdueShot.forEach(r => body.push(checkRow('dlg', r.dueDate, r, '原定 ' + fmtShort(keyToDate(r.dueDate)))));
    }
    foot = h('button', { type: 'button', className: 'btn', onclick: closeDialog }, ctx.todayRevs.length - ctx.todayDone > 0 ? '开始复习' : '知道了');
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

  if (state.dialog === 'settings') {
    title = '设置';
    sub = '改完马上生效，只保存在这台设备的这个浏览器里';
    const subjects = state.settings.subjects;

    // --- 界面颜色 ---
    body.push(h('h3', null, '界面颜色'));
    const themeSpot = h('span');
    if (window.SiteTheme) SiteTheme.mount(themeSpot, () => render());      // 三个按钮由 theme.js 生成；换色后重画一遍
    body.push(h('div', { className: 'set-row' }, h('div', null, h('p', null, '“跟随系统”会在手机或电脑开深色模式时自动变成夜间。')), themeSpot));

    // --- 记录方式 ---
    body.push(h('h3', null, '记录方式'));
    body.push(h('div', { className: 'set-row' },
      h('div', null, h('strong', null, '每天记几门'), h('p', null, subjects.length ? '每一门有自己的输入框，内容前面会自动加上科目名。' : '现在是 0 门：不分科目，一个大输入框随便写。')),
      stepper(subjects.length, 0, MAX_SUBJECTS, setSubjectCount, '每天记几门', 'subjects')));
    subjects.forEach((s, i) => {
      body.push(h('div', { className: 'set-row subject-row' },
        h('input', {
          type: 'text', maxlength: '12', value: s.name, placeholder: '第 ' + (i + 1) + ' 门的名字，比如' + (['英语', '数学', '专业课'][i % 3]),
          'aria-label': '第 ' + (i + 1) + ' 门的名字', 'data-fk': 'subject-name:' + i,
          // 打字时只保存，不重画（重画会打断输入）。关掉弹窗时界面会重画，新名字那时就用上了
          oninput: e => { s.name = e.target.value; saveSettings(); }
        }),
        h('span', { className: 'set-label' }, '记几个'),
        stepper(s.count, 1, MAX_PER_SUBJECT, n => setSubjectTarget(i, n), subjectName(i) + '每天记几个', 'target:' + i)));
    });

    // --- 备份 ---
    body.push(h('h3', null, '备份'));
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
      foot ? h('footer', { className: 'dialog-foot' }, foot) : null
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

// 打开时：今天有要复习的或有逾期的，而且这次打开还没看过摘要，就自动弹出今日摘要
(function start() {
  const todayKey = dateToKey(startOfToday());
  const rMap = getReviewMap();
  let seen = false;
  try { seen = sessionStorage.getItem(SS_DISMISSED) === todayKey; } catch (e) {}
  if (!seen && ((rMap[todayKey] || []).length > 0 || getOverdue(rMap).length > 0)) openDialog('summary');
  else render();
})();
