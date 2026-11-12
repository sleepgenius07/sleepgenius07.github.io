// ============================================================
//  界面颜色：跟随系统 / 日间 / 夜间
//  每个页面的 <head> 里都引用这个文件。它做两件事：
//  1) 页面一打开，就按上次的选择设置颜色（放在 <head> 里是为了避免先闪一下别的颜色）
//  2) 在页面里写了 data-theme-switch 的地方（每个页面顶部的导航栏里），放上三个切换按钮
//  原理：选“日间/夜间”时给 <html> 加 data-theme="light"/"dark"，style.css 根据它换颜色；
//        选“跟随系统”时去掉这个属性，颜色由系统的深色模式决定。
// ============================================================
(function () {
  var KEY = 'ebbinghaus-theme';                    // 存在浏览器里的名字
  var OPTIONS = [['system', '跟随系统'], ['light', '日间'], ['dark', '夜间']];
  var BAR = { light: '#eef2e6', dark: '#12171f' }; // 手机浏览器顶栏的颜色

  function get() {
    try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; }
    catch (e) { return 'system'; }
  }

  function apply(v) {
    var root = document.documentElement;
    if (v === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', v);
    // 顶栏颜色：页面里有“日间用”和“夜间用”两个 theme-color，手动选了就把两个都改成同一种
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i];
      if (!m.dataset.auto) m.dataset.auto = m.content;        // 记住原来的值，切回“跟随系统”时还原
      m.content = v === 'system' ? m.dataset.auto : BAR[v];
    }
  }

  function set(v) {
    try { if (v === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (e) {}
    apply(v);
    refresh();
  }

  // 把按钮的“选中”状态更新成当前的选择
  function refresh() {
    var now = get();
    var btns = document.querySelectorAll('[data-theme-value]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-checked', String(btns[i].dataset.themeValue === now));
  }

  // 在某个元素里放上三个按钮。onChange 是可选的：切换之后还想做点别的就传进来
  function mount(el, onChange) {
    el.className = 'seg';
    el.setAttribute('role', 'radiogroup');
    el.setAttribute('aria-label', '界面颜色');
    el.innerHTML = '';
    OPTIONS.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.themeValue = o[0];
      b.dataset.fk = 'theme:' + o[0];
      b.textContent = o[1];
      b.title = '界面颜色：' + o[1];
      b.setAttribute('aria-checked', String(o[0] === get()));   // 现在选中的是哪一个
      b.addEventListener('click', function () {
        // 屏幕窄时只显示一个按钮（其余两个被样式藏起来了）：这时点它是换到下一种
        var hidden = false, sibs = el.children;
        for (var k = 0; k < sibs.length; k++) if (getComputedStyle(sibs[k]).display === 'none') hidden = true;
        var v = o[0];
        if (hidden) { for (var j = 0; j < OPTIONS.length; j++) if (OPTIONS[j][0] === o[0]) v = OPTIONS[(j + 1) % OPTIONS.length][0]; }
        set(v);
        if (onChange) onChange(v);
      });
      el.appendChild(b);
    });
    refresh();
  }

  apply(get());
  document.addEventListener('DOMContentLoaded', function () {
    apply(get());                                   // 这时 <head> 里的 meta 都在了，再设一次顶栏颜色
    var spots = document.querySelectorAll('[data-theme-switch]');
    for (var i = 0; i < spots.length; i++) mount(spots[i]);
  });

  window.SiteTheme = { get: get, set: set, mount: mount };
})();
