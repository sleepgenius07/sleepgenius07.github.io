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
// 记住“今天的摘要已经看过了”，只在这次打开期间有效（关掉标签页就忘）
const SS_DISMISSED = 'ebbinghaus-summary-dismissed';

function dateToKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function keyToDate(k) { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function startOfToday() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function daysBetween(a, b) { return Math.round((a - b) / 86400000); }
function fmtDate(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
function fmtShort(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

// “记忆保持率”的示意公式：隔 days 天不复习，大约还记得多少（最低 20%）。
// 和首页那张图用的是同一个公式，只是示意，不是对个人记忆的测量。
function retentionRate(days) { return 0.2 + 0.8 * Math.exp(-0.45 * days); }

let state = {
  entries: {},        // 学习内容： { '2026-11-12': ['知识点A', '知识点B'] }
  completed: {},      // 完成记录： { '复习日期::学习日期::内容': true }
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  selectedDate: startOfToday(),
  inputText: '',
  dialog: null,       // 现在打开的弹窗：null / 'summary' 今日摘要 / 'overdue' 逾期清单 / 'data' 备份
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
}
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ entries: state.entries, completed: state.completed }));
  } catch (e) {}
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

function addEntries() {
  const lines = state.inputText.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const k = dateToKey(state.selectedDate);
  if (!state.entries[k]) state.entries[k] = [];
  lines.forEach(l => state.entries[k].push(l));
  state.inputText = '';
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

function openDialog(name) {
  state.dialog = name;
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
  const data = { app: 'ebbinghaus-review', version: 1, exportedAt: new Date().toISOString(), entries: state.entries, completed: state.completed };
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
      state.dataMsg = added || ticks
        ? '导入完成：新增 ' + added + ' 项学习内容、' + ticks + ' 条完成记录。'
        : '这份备份里的内容，这台设备上已经都有了。';
    } catch (e) {
      state.dataMsg = '这个文件读不出来。请选择从本站“导出备份”得到的 .json 文件。';
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
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', close: 'M6 6l12 12M18 6L6 18'
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

  // 重画之前，先记下：页面滚到哪了、键盘焦点在哪个元素上，画完再恢复
  const app = document.getElementById('app');
  const scrollY = window.scrollY;
  const scrolls = {};
  app.querySelectorAll('[data-sk]').forEach(el => { scrolls[el.dataset.sk] = el.scrollTop; });
  const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  const caret = focusKey === 'input' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;

  app.innerHTML = '';

  // ---------- 顶部：今天的情况 ----------
  const todayLeft = todayRevs.length - todayDone;
  let line;
  if (todayRevs.length === 0) line = totalLearned === 0 ? '还没有记录。在下面写下今天学的内容，复习日程会自动排好。' : '今天没有要复习的内容。';
  else if (todayLeft === 0) line = '今天的 ' + todayRevs.length + ' 项都复习完了。';
  else line = '今天要复习 ' + todayRevs.length + ' 项，已完成 ' + todayDone + ' 项。';

  app.appendChild(h('section', { className: 'strip' },
    h('div', { className: 'strip-inner' },
      h('div', { className: 'strip-main' },
        h('h1', null, fmtDate(today), h('small', null, '周' + WEEKDAYS[today.getDay()])),
        h('p', { className: 'strip-line' }, line),
        todayRevs.length > 0 ? h('div', { className: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(todayRevs.length), 'aria-valuenow': String(todayDone), 'aria-label': '今日复习进度' },
          h('div', { className: 'progress-fill' + (todayLeft === 0 ? ' full' : ''), style: { width: (todayDone / todayRevs.length * 100) + '%' } })) : null
      ),
      h('div', { className: 'strip-side' },
        streak > 0 ? h('span', { className: 'streak', title: '某一天的复习全部完成才算数' }, '连续 ', h('b', null, streak), ' 天') : null,
        overdue.length > 0 ? h('button', { type: 'button', className: 'chip late', 'data-fk': 'open-overdue', onclick: () => openDialog('overdue') }, '逾期 ' + overdue.length + ' 项') : null,
        h('button', { type: 'button', className: 'chip', 'data-fk': 'open-summary', onclick: () => openDialog('summary') }, '今日摘要'),
        h('button', { type: 'button', className: 'chip', 'data-fk': 'open-data', onclick: () => openDialog('data') }, '备份')
      )
    )
  ));

  // ---------- 主体：左边日历，右边选中那天的内容 ----------
  const side = h('aside', { className: 'side' });
  const day = h('section', { className: 'day' });
  app.appendChild(h('div', { className: 'workspace' }, side, day));

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
    const revs = rMap[dk] || [];
    const done = revs.filter(r => isCompleted(dk, r.content, r.learnedOn)).length;
    const isSel = sameDay(d.date, state.selectedDate);
    const isTd = sameDay(d.date, today);
    // 复习圆点的状态：全部完成=绿，日子过了没做完=红，其余=黄
    const revState = !revs.length ? '' : done === revs.length ? 'done' : d.date < today ? 'late' : 'due';

    let label = fmtDate(d.date) + (isTd ? '，今天' : '');
    if (learned) label += '，学了 ' + learned + ' 项';
    if (revs.length) label += '，复习 ' + done + '/' + revs.length + (revState === 'late' ? '，逾期' : '');

    grid.appendChild(h('button', {
      type: 'button',
      className: 'cal-day' + (isSel ? ' selected' : '') + (isTd ? ' today' : '') + (d.outside ? ' outside' : ''),
      'aria-label': label, 'aria-pressed': String(isSel), 'data-fk': 'day:' + dk,
      onclick: () => { state.selectedDate = d.date; render(); }
    },
      h('span', { className: 'cal-num' }, d.date.getDate()),
      h('span', { className: 'cal-dots' },
        learned ? h('i', { className: 'dot learned' }) : null,
        revState ? h('i', { className: 'dot ' + revState }) : null)
    ));
  });
  cal.appendChild(grid);
  cal.appendChild(h('div', { className: 'legend' },
    h('span', null, h('i', { className: 'dot learned' }), '学了新内容'),
    h('span', null, h('i', { className: 'dot due' }), '待复习'),
    h('span', null, h('i', { className: 'dot done' }), '已完成'),
    h('span', null, h('i', { className: 'dot late' }), '逾期')
  ));
  side.appendChild(cal);

  // ----- 累计 -----
  side.appendChild(h('div', { className: 'sheet totals' },
    h('div', null, h('b', null, totalLearned), h('span', null, '已学内容')),
    h('div', null, h('b', null, Object.keys(state.entries).length), h('span', null, '学习天数')),
    h('div', null, h('b', null, totalDone), h('span', null, '完成复习'))
  ));

  // ----- 记忆曲线小图 -----
  side.appendChild(curveCard());

  // ----- 右边：选中的这一天 -----
  const diff = daysBetween(state.selectedDate, today);
  const rel = diff === 0 ? '今天' : diff === 1 ? '明天' : diff === -1 ? '昨天' : diff > 0 ? diff + ' 天后' : (-diff) + ' 天前';
  day.appendChild(h('header', { className: 'day-head' },
    h('h2', null, fmtDate(state.selectedDate), h('small', null, '周' + WEEKDAYS[state.selectedDate.getDay()])),
    h('span', { className: 'tag' + (diff === 0 ? ' now' : '') }, rel),
    diff !== 0 ? h('button', { type: 'button', className: 'link-btn', 'data-fk': 'back-today', onclick: () => goToDate(today) }, '回到今天') : null
  ));

  // 需要复习
  if (dayReviews.length > 0) {
    const doneCount = dayReviews.filter(r => isCompleted(selKey, r.content, r.learnedOn)).length;
    const sec = h('div', { className: 'sheet block' },
      h('div', { className: 'block-head' },
        h('h3', null, '需要复习'),
        h('span', { className: 'count' }, '已完成 ' + doneCount + ' / ' + dayReviews.length))
    );
    if (diff < 0 && doneCount < dayReviews.length) {
      sec.appendChild(h('p', { className: 'block-note late' }, '这一天已经过去了。补上之后照常打勾就行。'));
    }
    groupByLearned(dayReviews).forEach(g => {
      sec.appendChild(groupHead(g));
      g.items.forEach(r => sec.appendChild(checkRow('day', selKey, r)));
    });
    day.appendChild(sec);
  }

  // 记录学习内容
  const addBtn = h('button', { type: 'button', className: 'btn add-btn', 'data-fk': 'add', disabled: !state.inputText.trim(), onclick: addEntries }, '添加到 ' + fmtDate(state.selectedDate));
  const ta = h('textarea', {
    id: 'learn-input', rows: '3', 'data-fk': 'input',
    placeholder: '每行写一个知识点，例如：\n英语单词：abandon, abolish\n数学：导数的基本公式',
    oninput: e => { state.inputText = e.target.value; addBtn.disabled = !state.inputText.trim(); },
    onkeydown: e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addEntries(); } }
  });
  ta.value = state.inputText;
  day.appendChild(h('div', { className: 'sheet block' },
    h('div', { className: 'block-head' },
      h('h3', null, h('label', { for: 'learn-input' }, diff === 0 ? '记下今天学的' : '记下这一天学的')),
      h('span', { className: 'count' }, '每行一个知识点')),
    ta,
    h('div', { className: 'add-row' }, addBtn, h('span', { className: 'kbd-hint' }, '也可以按 Ctrl + Enter'))
  ));

  // 这一天学的
  if (dayLearned.length > 0) {
    const sec = h('div', { className: 'sheet block' },
      h('div', { className: 'block-head' },
        h('h3', null, diff === 0 ? '今天学的' : '这一天学的'),
        h('span', { className: 'count' }, dayLearned.length + ' 项'))
    );
    dayLearned.forEach((item, idx) => {
      // 六个小圆点：这条内容的六次复习各自的进度
      const pips = REVIEW_INTERVALS.map((interval, i) => {
        const rd = addDays(state.selectedDate, interval);
        const st = isCompleted(dateToKey(rd), item, selKey) ? 'done' : rd < today ? 'late' : sameDay(rd, today) ? 'due' : 'todo';
        return h('i', { className: 'pip ' + st });
      });
      const doneN = REVIEW_INTERVALS.filter(n => isCompleted(dateToKey(addDays(state.selectedDate, n)), item, selKey)).length;
      sec.appendChild(h('div', { className: 'item learn-item' },
        h('span', { className: 'item-text' }, item),
        h('span', { className: 'pips', role: 'img', 'aria-label': '六次复习已完成 ' + doneN + ' 次', title: '六次复习已完成 ' + doneN + ' 次' }, pips),
        h('button', { type: 'button', className: 'del-btn', 'aria-label': '删除：' + item, 'data-fk': 'del:' + idx, onclick: () => deleteEntry(selKey, idx) }, icon('close'))
      ));
    });
    // 复习安排：点日期可以直接跳过去
    sec.appendChild(h('p', { className: 'plan-label' }, '这些内容的复习日（点一下可以跳过去）：'));
    sec.appendChild(h('div', { className: 'plan' }, REVIEW_INTERVALS.map((interval, i) => {
      const rd = addDays(state.selectedDate, interval);
      const rk = dateToKey(rd);
      const mine = (rMap[rk] || []).filter(r => r.learnedOn === selKey);
      const allDone = mine.length > 0 && mine.every(r => isCompleted(rk, r.content, r.learnedOn));
      const st = allDone ? 'done' : rd < today ? 'late' : sameDay(rd, today) ? 'due' : 'todo';
      return h('button', { type: 'button', className: 'plan-chip ' + st, 'data-fk': 'plan:' + i, onclick: () => goToDate(rd) },
        h('b', null, fmtShort(rd)), h('span', null, '第 ' + (i + 1) + ' 次'));
    })));
    day.appendChild(sec);
  }

  // 这一天什么都没有
  if (dayLearned.length === 0 && dayReviews.length === 0) {
    day.appendChild(h('p', { className: 'empty' }, '这一天还没有学习或复习内容。在上面写下学到的东西，六次复习会自动排进日历。'));
  }

  // ---------- 弹窗 ----------
  if (state.dialog) app.appendChild(dialogNode({ today, todayKey, todayRevs, todayDone, streak, totalLearned, totalDone }));

  // 恢复滚动位置和键盘焦点
  window.scrollTo(0, scrollY);
  app.querySelectorAll('[data-sk]').forEach(el => { if (scrolls[el.dataset.sk]) el.scrollTop = scrolls[el.dataset.sk]; });
  if (focusKey) {
    const el = app.querySelector('[data-fk="' + (window.CSS && CSS.escape ? CSS.escape(focusKey) : focusKey) + '"]');
    if (el) { el.focus({ preventScroll: true }); if (caret && el.setSelectionRange) el.setSelectionRange(caret[0], caret[1]); }
  }
}

// 左下角的记忆曲线小图（和首页是同一个公式）
function curveCard() {
  const W = 320, H = 132, left = 8, right = 8, top = 12, bottom = 26, LAST = 32;
  const x = d => left + (W - left - right) * d / LAST;
  const y = r => top + (H - top - bottom) * (1 - r);
  const keep = (d, k) => 0.2 + 0.8 * Math.exp(-k * d);
  const f = n => n.toFixed(1);
  let fading = '';
  for (let d = 0; d <= LAST; d += 0.25) fading += (d ? 'L' : 'M') + f(x(d)) + ',' + f(y(keep(d, 0.45)));
  let saw = 'M' + f(x(0)) + ',' + f(y(1)); let from = 0, k = 0.45;
  REVIEW_INTERVALS.concat(LAST).forEach((to, i) => {
    for (let d = from + 0.25; d <= to; d += 0.25) saw += 'L' + f(x(d)) + ',' + f(y(keep(d - from, k)));
    if (i < REVIEW_INTERVALS.length) saw += 'L' + f(x(to)) + ',' + f(y(1));
    from = to; k *= 0.55;
  });
  const days = REVIEW_INTERVALS.map(d => '<text class="c-day" x="' + f(x(d)) + '" y="' + (H - 8) + '" text-anchor="middle">' + d + '</text>').join('');
  const card = h('div', { className: 'sheet curve-card' });
  card.innerHTML =
    '<h3>为什么是这六天</h3>' +
    '<p>每复习一次，就忘得更慢一点，所以间隔可以越拉越长。</p>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="示意图：不复习时记忆很快变淡；在第 1、2、4、7、15、30 天复习，记忆一直保持在高位。">' +
    '<line class="c-grid" x1="' + left + '" x2="' + (W - right) + '" y1="' + f(y(0)) + '" y2="' + f(y(0)) + '"/>' +
    '<path class="c-fading" d="' + fading + '"/>' +
    '<path class="c-saw" d="' + saw + '"/>' + days +
    '<text class="c-lab-saw" x="' + f(x(18)) + '" y="' + f(y(0.58)) + '">按时复习</text>' +
    '<text class="c-lab-fading" x="' + f(x(18)) + '" y="' + f(y(0.28)) + '">不复习</text>' +
    '</svg>';
  return card;
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

  if (state.dialog === 'data') {
    title = '备份';
    sub = '记录只存在这台设备的这个浏览器里';
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', className: 'file-input', onchange: e => { if (e.target.files[0]) importBackup(e.target.files[0]); } });
    body.push(h('p', { className: 'dialog-text' }, '现在这里有 ' + ctx.totalLearned + ' 项学习内容、' + ctx.totalDone + ' 条完成记录。清除浏览器数据或换设备之前，先导出一份备份。'));
    body.push(h('div', { className: 'data-row' },
      h('div', null, h('h3', null, '导出备份'), h('p', null, '把全部记录存成一个文件，下载到这台设备。')),
      h('button', { type: 'button', className: 'btn', 'data-fk': 'export', disabled: ctx.totalLearned === 0, onclick: exportBackup }, '导出')));
    body.push(h('div', { className: 'data-row' },
      h('div', null, h('h3', null, '导入备份'), h('p', null, '从备份文件里把记录加回来。只会添加，不会删掉这里已有的内容。')),
      h('button', { type: 'button', className: 'btn ghost', 'data-fk': 'import', onclick: () => fileInput.click() }, '选择文件'),
      fileInput));
    if (state.dataMsg) body.push(h('p', { className: 'data-msg', role: 'status' }, state.dataMsg));
  }

  return h('div', { className: 'overlay', onclick: closeDialog },
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

// 打开时：今天有要复习的或有逾期的，而且这次打开还没看过摘要，就自动弹出今日摘要
(function start() {
  const todayKey = dateToKey(startOfToday());
  const rMap = getReviewMap();
  let seen = false;
  try { seen = sessionStorage.getItem(SS_DISMISSED) === todayKey; } catch (e) {}
  if (!seen && ((rMap[todayKey] || []).length > 0 || getOverdue(rMap).length > 0)) openDialog('summary');
  else render();
})();
