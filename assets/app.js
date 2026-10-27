/* ============================================================
   隐形劳动账本 · Invisible Labor Ledger
   应用主逻辑：状态、路由、六个视图、交互
   ============================================================ */

(function () {
  'use strict';

  const LS_KEY = 'ill.v1';
  const LABEL_KEY = { '统筹类': 'coord', '情绪类': 'emo', '记忆类': 'mem', '补救类': 'fix' };

  const DEFAULT_SETTINGS = {
    self: '妈妈',
    partner: '爸爸',
    child: '孩子',
    wage: 40,
    autoReport: true,
    reportHour: 21,
    push: { type: 'none', url: '' }
  };

  function freshState() {
    return {
      version: 1,
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      customDict: [],
      records: [],
      reports: []
    };
  }

  let S = load();
  const UI = {
    view: 'dict',
    dictCat: 'all',
    dictStar: 0,
    q: '',
    raw: '',
    parsed: [],
    dropped: [],
    period: 'this',
    weekOffset: 0,
    report: null,
    showAdd: false
  };

  /* ---------------- 存储 ---------------- */

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return freshState();
      const s = JSON.parse(raw);
      const base = freshState();
      return {
        version: 1,
        settings: Object.assign(base.settings, s.settings || {}),
        customDict: Array.isArray(s.customDict) ? s.customDict : [],
        records: Array.isArray(s.records) ? s.records : [],
        reports: Array.isArray(s.reports) ? s.reports : []
      };
    } catch (e) {
      return freshState();
    }
  }

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
  }

  /* ---------------- 工具 ---------------- */

  const $ = sel => document.querySelector(sel);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function starHTML(n) {
    let out = '';
    for (let i = 1; i <= 5; i++) out += '<span class="' + (i <= n ? '' : 'off') + '">★</span>';
    return '<span class="stars" title="心理负荷指数 ' + n + '/5">' + out + '</span>';
  }

  function catTags(cats) {
    return (cats || []).map(c => '<span class="tag ' + (LABEL_KEY[c] || 'coord') + '">' + c + '</span>').join(' ');
  }

  function highlightJSON(obj) {
    const s = esc(JSON.stringify(obj, null, 2));
    return s
      .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="k">$1</span>$2')
      .replace(/: (&quot;[^&]*?&quot;)/g, ': <span class="s">$1</span>')
      .replace(/: (\d+(?:\.\d+)?)/g, ': <span class="n">$1</span>');
  }

  function allDict() { return DICT.concat(S.customDict); }

  function md(d) {
    const x = new Date(d);
    return (x.getMonth() + 1) + '-' + (x.getDate() < 10 ? '0' : '') + x.getDate();
  }

  function nowISO() { return new Date().toISOString(); }

  /* ---------------- 安装到手机（PWA） ---------------- */

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (UI.view === 'settings') render();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    toast('已安装到桌面');
    if (UI.view === 'settings') render();
  });

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function isAndroid() { return /Android/i.test(navigator.userAgent); }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function siteURL() { return location.origin + location.pathname; }

  function installCard() {
    const head = '<div class="card-title">装到手机</div>';

    if (isStandalone()) {
      return '<div class="card dark">' + head +
        '<p class="small" style="color:rgba(245,242,234,.82);line-height:1.9;margin:0">' +
        '当前已作为独立应用运行：无地址栏，断网可打开，数据仍只存在本机。' +
        '如需更新，联网打开一次即可自动拉取新版本。</p></div>';
    }

    let steps;
    if (isAndroid()) {
      steps = 'Chrome 右上角 <b>⋮</b> → <b>安装应用</b>（旧版叫「添加到主屏幕」）';
    } else if (isIOS()) {
      steps = 'Safari 底部 <b>分享</b> → <b>添加到主屏幕</b>';
    } else {
      steps = '桌面 Chrome / Edge 地址栏右侧的<b>安装</b>图标 → 安装';
    }

    return '<div class="card">' + head +
      '<p class="small muted" style="margin:0 0 12px;line-height:1.8">' +
      '装到桌面后有独立图标与启动画面，离线可用，不会把数据上传到任何服务器。</p>' +
      '<div class="row" style="margin-bottom:12px">' +
      (deferredPrompt ? '<button class="btn accent sm" data-act="install">立即安装</button>' : '') +
      '<button class="btn ghost sm" data-act="copy-link">复制本站链接</button>' +
      '</div>' +
      '<p class="small" style="margin:0;line-height:1.85">手动方式：' + steps + '</p>' +
      '<p class="small muted" style="margin:8px 0 0;line-height:1.85">' +
      '把上面的链接发到手机微信/浏览器里打开，再按上述步骤添加。iOS 只能通过 Safari 添加。</p>' +
      '</div>';
  }

  /* ---------------- 路由 ---------------- */

  const VIEWS = ['dict', 'capture', 'board', 'weekly', 'prompts', 'settings'];

  function route() {
    const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    UI.view = VIEWS.indexOf(raw) === -1 ? 'dict' : raw;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    document.querySelectorAll('#tabs a').forEach(a => {
      a.classList.toggle('active', a.dataset.view === UI.view);
    });
    renderTopMeta();
    const el = $('#view');
    if (UI.view === 'dict') el.innerHTML = viewDict();
    else if (UI.view === 'capture') el.innerHTML = viewCapture();
    else if (UI.view === 'board') el.innerHTML = viewBoard();
    else if (UI.view === 'weekly') el.innerHTML = viewWeekly();
    else if (UI.view === 'prompts') el.innerHTML = viewPrompts();
    else el.innerHTML = viewSettings();
    afterRender();
  }

  function renderTopMeta() {
    const st = Reporter.summarize(S.records, S.settings, new Date());
    const rate = (st.byOwner[st.self].share * 100).toFixed(0);
    $('#topmeta').innerHTML =
      '本周 <b>' + Reporter.fmtMin(st.totalMin) + '</b>' +
      '<span style="color:var(--ink-4)">|</span>' +
      st.self + ' 分配率 <b>' + rate + '%</b>';
  }

  /* ============================================================
     视图一 · 词典
     ============================================================ */

  function viewDict() {
    const all = allDict();
    const q = UI.q.trim();
    let list = all.filter(it => {
      if (UI.dictCat !== 'all' && it.cat !== UI.dictCat) return false;
      if (UI.dictStar && it.star !== UI.dictStar) return false;
      if (q) {
        const hay = it.name + (it.note || '') + (it.kw || []).join('');
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    const totalMin = all.reduce((a, b) => a + b.min, 0);
    const avgStar = (all.reduce((a, b) => a + b.star, 0) / (all.length || 1)).toFixed(2);

    const cats = UI.dictCat === 'all' ? ['coord', 'emo', 'mem', 'fix'] : [UI.dictCat];

    let groups = '';
    cats.forEach(ck => {
      const items = list.filter(i => i.cat === ck);
      if (!items.length) return;
      const c = CATS[ck];
      const sumMin = items.reduce((a, b) => a + b.min, 0);
      const sumStar = items.reduce((a, b) => a + b.star, 0);
      groups +=
        '<section class="dict-group">' +
          '<h3><span class="tag ' + c.tag + '">' + c.label + '</span>' + items.length + ' 项' +
            '<span class="small muted" style="font-weight:400;font-family:var(--mono);font-size:11px">' +
            '　单次合计 ' + Reporter.fmtMin(sumMin) + '　平均负荷 ' + (sumStar / items.length).toFixed(1) + '★</span>' +
          '</h3>' +
          '<p class="gdesc">' + esc(c.desc) + '</p>' +
          '<table class="ledger">' +
            '<thead><tr><th style="width:34px">#</th><th>条目</th><th style="width:88px">心理负荷</th>' +
            '<th style="width:90px">默认耗时</th><th style="width:96px">操作</th></tr></thead>' +
            '<tbody>' +
            items.map((it, i) =>
              '<tr>' +
                '<td class="idx">' + String(i + 1).padStart(2, '0') + '</td>' +
                '<td class="name">' + esc(it.name) + '<span class="note">' + esc(it.note || '') + '</span></td>' +
                '<td>' + starHTML(it.star) + '</td>' +
                '<td class="num">' + it.min + ' 分钟</td>' +
                '<td><button class="btn ghost sm" data-act="prefill" data-name="' + esc(it.name) + '">记一笔</button></td>' +
              '</tr>'
            ).join('') +
            '</tbody>' +
          '</table>' +
        '</section>';
    });

    if (!list.length) groups = '<div class="empty"><b>无匹配条目</b>换一个关键词，或清除筛选条件。</div>';

    return '' +
      '<div class="page-head">' +
        '<div>' +
          '<div class="kicker">Step 01 / Taxonomy</div>' +
          '<h2>隐形劳动词典</h2>' +
          '<p class="lead">四类框架：统筹、情绪、记忆、补救。条目以动词开头、具体到可执行；' +
          '每一项标注心理负荷指数（1–5★）与一次完整执行的中位耗时——含任务切换成本。</p>' +
        '</div>' +
        '<div class="row">' +
          '<div class="stat"><span class="stat-label">条目总数</span><span class="stat-value">' + all.length + '</span></div>' +
          '<div class="stat"><span class="stat-label">单次合计</span><span class="stat-value">' +
            (totalMin / 60).toFixed(1) + '<small>小时</small></span></div>' +
          '<div class="stat"><span class="stat-label">平均负荷</span><span class="stat-value">' +
            avgStar + '<small>★</small></span></div>' +
        '</div>' +
      '</div>' +

      '<div class="dict-toolbar">' +
        '<input type="text" id="q" placeholder="搜索条目 / 关键词" value="' + esc(UI.q) + '" style="max-width:240px">' +
        '<div class="chip-group">' +
          chip('dictCat', 'all', '全部') +
          ['coord', 'emo', 'mem', 'fix'].map(k => chip('dictCat', k, CATS[k].label)).join('') +
        '</div>' +
        '<span style="width:1px;height:20px;background:var(--line-2)"></span>' +
        '<div class="chip-group">' +
          chip('dictStar', 0, '任意负荷') +
          [5, 4, 3].map(n => chip('dictStar', n, n + '★')).join('') +
        '</div>' +
        '<span class="grow"></span>' +
        '<button class="btn ghost sm" data-act="toggle-add">+ 自定义条目</button>' +
      '</div>' +

      (UI.showAdd ? formAddDict() : '') +
      groups +
      '<div class="card dark" style="margin-top:8px">' +
        '<div class="card-title" style="color:var(--paper)">分类原则 <span class="tag" style="border-color:rgba(245,242,234,.35);color:rgba(245,242,234,.7)">为什么这样切</span></div>' +
        '<p class="small" style="margin:0;line-height:1.9;color:rgba(245,242,234,.82)">' +
        '不按“谁做什么”切，而按<strong>认知资源的占用方式</strong>切：统筹消耗的是规划能力，情绪消耗的是情绪容量，' +
        '记忆消耗的是注意力带宽，补救消耗的是应急时间。四类都不产出可见成果，因此在家庭内部记账时全部消失。' +
        '本词典的作用不是罗列，而是让“消失”变成“可计量的条目”。</p>' +
      '</div>';
  }

  function chip(kind, val, label) {
    const cur = kind === 'dictCat' ? UI.dictCat : UI.dictStar;
    const on = String(cur) === String(val);
    return '<span class="chip' + (on ? ' on' : '') + '" data-act="' + kind + '" data-val="' + val + '">' + label + '</span>';
  }

  function formAddDict() {
    return '' +
      '<div class="card" style="margin-bottom:22px">' +
        '<div class="card-title">新增自定义条目</div>' +
        '<div class="grid g3">' +
          '<div class="field"><label>名称</label><input type="text" id="nd-name" placeholder="动词开头，具体到可执行"></div>' +
          '<div class="field"><label>类别</label><select id="nd-cat">' +
            '<option value="coord">统筹类</option><option value="emo">情绪类</option>' +
            '<option value="mem">记忆类</option><option value="fix">补救类</option></select></div>' +
          '<div class="field"><label>心理负荷 (1-5)</label><select id="nd-star">' +
            [1, 2, 3, 4, 5].map(n => '<option value="' + n + '"' + (n === 4 ? ' selected' : '') + '>' + n + ' ★</option>').join('') +
          '</select></div>' +
        '</div>' +
        '<div class="grid g2">' +
          '<div class="field"><label>默认耗时（分钟）</label><input type="number" id="nd-min" value="20" min="1" max="600"></div>' +
          '<div class="field"><label>隐秘性说明</label><input type="text" id="nd-note" placeholder="它为什么不被看见"></div>' +
        '</div>' +
        '<div class="row"><button class="btn accent" data-act="add-dict">保存条目</button>' +
          '<button class="btn ghost" data-act="toggle-add">取消</button></div>' +
      '</div>';
  }

  /* ============================================================
     视图二 · 记录（语音转数据）
     ============================================================ */

  function viewCapture() {
    const recents = S.records.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 12);

    return '' +
      '<div class="page-head">' +
        '<div>' +
          '<div class="kicker">Step 02 / Capture</div>' +
          '<h2>语音转数据</h2>' +
          '<p class="lead">说一段抱怨，系统只做一件事：把它切成结构化的任务条目。' +
          '不评价、不安慰、不提建议。未提及伴侣时，伴侣在该任务上的耗时记为 0。</p>' +
        '</div>' +
      '</div>' +

      '<div class="split">' +
        '<div>' +
          '<div class="card">' +
            '<div class="card-title">输入 <span class="tag">语音 / 文字</span></div>' +
            '<div class="capture-box">' +
              '<textarea id="raw" placeholder="例如：今天气死我了，我刚安抚完娃，又去提醒他爸明天要交幼儿园手工作业">' +
                esc(UI.raw || '') +
              '</textarea>' +
              '<div class="row" style="margin-top:12px">' +
                '<button class="mic" data-act="mic" id="micbtn"><span class="pulse"></span><span id="miclabel">语音输入</span></button>' +
                '<span class="small muted" id="micstat"></span>' +
                '<span class="grow"></span>' +
                '<button class="btn ghost sm" data-act="sample">填入示例</button>' +
                '<button class="btn accent" data-act="parse">解析</button>' +
              '</div>' +
            '</div>' +
            '<p class="small muted" style="margin:12px 0 0">支持一次输入多件事。系统按标点与连接词（然后 / 又去 / 顺便 / 之后）切句，逐句分类。</p>' +
          '</div>' +

          '<div class="card" style="margin-top:18px">' +
            '<div class="card-title">最近记录 <span class="tag">' + S.records.length + ' 条</span></div>' +
            (recents.length ? '<ul class="feed">' + recents.map(r =>
              '<li>' +
                '<div class="d">' + md(r.date) + '</div>' +
                '<div class="t">' + esc(r.name) + '<em>' + r.cats.join(' + ') + ' · ' + r.owner + ' · ' + r.star + '★</em></div>' +
                '<div class="r">' + r.minutes + "' · ¥" + r.value +
                  ' <button class="btn ghost sm" data-act="del-rec" data-id="' + r.id + '" style="margin-left:6px">×</button></div>' +
              '</li>').join('') + '</ul>'
              : '<div class="empty"><b>暂无记录</b>先在上方输入一段话，点“解析”。</div>') +
          '</div>' +
        '</div>' +

        '<div>' +
          (UI.parsed.length ? parsedPanel() :
            '<div class="card"><div class="card-title">结构化输出</div>' +
            '<div class="empty"><b>等待输入</b>解析后，这里会给出规定格式的 JSON 与可编辑条目。</div>' +
            '<p class="small muted" style="margin:14px 0 0">输出字段固定为六项：任务名称、任务类型、承担者、隐形劳动判定、预计耗时、折合家政时薪价值。' +
            '这是唯一允许的输出形态。</p></div>')
        '</div>' +
      '</div>';
  }

  function parsedPanel() {
    const spec = UI.parsed.map(t => Parser.toSpecJson(t));
    const totalMin = UI.parsed.reduce((a, b) => a + b.minutes, 0);
    const totalVal = UI.parsed.reduce((a, b) => a + b.value, 0);

    return '' +
      '<div class="card">' +
        '<div class="card-title">结构化输出 <span class="tag">' + UI.parsed.length + ' 条 / ' +
          Reporter.fmtMin(totalMin) + ' / ' + Reporter.money(totalVal) + '</span></div>' +

        UI.parsed.map((t, i) =>
          '<div class="parsed-item">' +
            '<div class="pi-head">' +
              '<div class="pi-name">' + esc(t.name) + '</div>' +
              '<div class="row" style="gap:8px">' + starHTML(t.star) +
                '<button class="btn ghost icon" data-act="drop-parsed" data-idx="' + i + '">×</button></div>' +
            '</div>' +
            '<div class="row" style="gap:6px;margin-bottom:10px">' + catTags(t.cats) +
              (t.partnerMentioned ? '<span class="tag no">提及伴侣 · 其耗时 0</span>' : '') + '</div>' +
            '<dl class="kv">' +
              '<dt>承担者</dt><dd>' + esc(t.owner) + '</dd>' +
              '<dt>隐形劳动判定</dt><dd>' + esc(t.judged) + '</dd>' +
              '<dt>预计耗时</dt><dd>' +
                '<input type="number" data-edit="min" data-idx="' + i + '" value="' + t.minutes + '" min="1" max="600" ' +
                'style="width:78px;display:inline-block;padding:3px 7px"> 分钟' +
              '</dd>' +
              '<dt>折合价值</dt><dd>' + Reporter.money(t.value) + '</dd>' +
              '<dt>伴侣耗时</dt><dd>' + t.partnerMinutes + ' 分钟</dd>' +
              '<dt>状态</dt><dd>' +
                '<select data-edit="status" data-idx="' + i + '" style="width:128px;padding:3px 7px">' +
                  '<option value="done"' + (t.status === 'done' ? ' selected' : '') + '>完成</option>' +
                  '<option value="undone"' + (t.status === 'undone' ? ' selected' : '') + '>未完成</option>' +
                  '<option value="promised"' + (t.status === 'promised' ? ' selected' : '') + '>承诺未打卡</option>' +
                '</select></dd>' +
            '</dl>' +
          '</div>'
        ).join('') +

        '<div class="card-title" style="margin-top:18px">JSON 输出 <span class="tag">规定格式</span></div>' +
        '<pre class="json">' + highlightJSON(spec.length === 1 ? spec[0] : spec) + '</pre>' +

        '<div class="row" style="margin-top:14px">' +
          '<button class="btn accent" data-act="save-all">全部入账</button>' +
          '<button class="btn ghost" data-act="copy-json">复制 JSON</button>' +
          '<button class="btn ghost" data-act="clear-parsed">清空</button>' +
        '</div>' +
      '</div>' +
      (UI.dropped && UI.dropped.length ?
        '<div class="card tight" style="margin-top:14px">' +
          '<div class="card-title" style="font-size:13px">未产生任务的片段 <span class="tag">' + UI.dropped.length + '</span></div>' +
          UI.dropped.map(d => '<p class="small muted" style="margin:4px 0">「' + esc(d.clause) + '」— ' + esc(d.why) + '</p>').join('') +
        '</div>' : '');
  }

  /* ============================================================
     视图三 · 看板
     ============================================================ */

  function periodRange() {
    const now = new Date();
    if (UI.period === 'last') {
      const st = Reporter.weekStartOf(Reporter.addDays(now, -7));
      return { start: st, span: 7, label: '上周' };
    }
    if (UI.period === 'month') {
      const st = Reporter.weekStartOf(Reporter.addDays(now, -21));
      return { start: st, span: 28, label: '近 4 周' };
    }
    return { start: Reporter.weekStartOf(now), span: 7, label: '本周' };
  }

  function viewBoard() {
    const pr = periodRange();
    const st = Reporter.summarize(S.records, S.settings, pr.start, pr.span);
    const self = st.self, partner = st.partner;
    const selfO = st.byOwner[self], partO = st.byOwner[partner];

    const seg = (k, label) => '<span class="chip' + (UI.period === k ? ' on' : '') + '" data-act="period" data-val="' + k + '">' + label + '</span>';

    const maxCatMin = Math.max(1, ...Reporter.CAT_ORDER.map(c => st.catTotals[c].min));

    const catRows = Reporter.CAT_ORDER.map(c => {
      const ct = st.catTotals[c];
      const tot = ct.min || 1;
      const cSelf = ct.selfMin / tot * 100;
      const cPart = ct.partnerMin / tot * 100;
      const width = ct.min ? Math.max(3, ct.min / maxCatMin * 100) : 0;
      return '<div class="stack-row">' +
          '<span class="lbl">' + Reporter.CAT_NAME[c].slice(0, 2) + '</span>' +
          '<div class="stack-track"><div class="stack-inner" style="width:' + width + '%">' +
            '<i style="width:' + cSelf + '%;background:var(--accent)"></i>' +
            '<i style="width:' + cPart + '%;background:var(--coord)"></i>' +
          '</div></div>' +
          '<span class="val">' + Reporter.fmtMin(ct.min) + '</span>' +
        '</div>';
    }).join('');

    const highList = st.list.slice()
      .sort((a, b) => (b.star - a.star) || (b.minutes - a.minutes))
      .slice(0, 5);

    const redList = highList.map((r, i) =>
      '<li><span class="rk">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span>' + esc(r.name) + '</span>' +
      '<span class="lv">' + r.star + '★</span>' +
      '<span class="meta">' + esc(r.owner) + ' · ' + r.minutes + "'</span></li>").join('');

    const blackList = st.undone.slice(0, 6).map((r, i) =>
      '<li><span class="rk">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span>' + esc(r.name) + '</span>' +
      '<span class="meta">' + esc(r.owner) + ' · ' + (r.status === 'promised' ? '承诺未打卡' : '未完成') + '</span></li>').join('');

    return '' +
      '<div class="page-head">' +
        '<div>' +
          '<div class="kicker">Step 03 / Ledger</div>' +
          '<h2>看板</h2>' +
          '<p class="lead">' + pr.label + '：' + Reporter.dateKey(st.weekStart) + ' 至 ' + Reporter.dateKey(st.weekEnd) +
          '　共 ' + st.totalCount + ' 条记录。折合金额按家政时薪 ¥' + S.settings.wage + '/小时 计。</p>' +
        '</div>' +
        '<div class="row">' + seg('this', '本周') + seg('last', '上周') + seg('month', '近 4 周') + '</div>' +
      '</div>' +

      '<div class="grid g4" style="margin-bottom:18px">' +
        '<div class="card tight"><div class="stat">' +
          '<span class="stat-label">' + esc(self) + ' 时长</span>' +
          '<span class="stat-value">' + (selfO.min / 60).toFixed(1) + '<small>小时</small></span>' +
          '<span class="stat-sub">' + selfO.count + ' 项 · ' + Reporter.money(selfO.val) + '</span></div></div>' +
        '<div class="card tight"><div class="stat">' +
          '<span class="stat-label">' + esc(partner) + ' 时长</span>' +
          '<span class="stat-value">' + (partO.min / 60).toFixed(1) + '<small>小时</small></span>' +
          '<span class="stat-sub">' + partO.count + ' 项 · ' + Reporter.money(partO.val) + '</span></div></div>' +
        '<div class="card tight"><div class="stat">' +
          '<span class="stat-label">分配率</span>' +
          '<span class="stat-value">' + (selfO.share * 100).toFixed(1) + '<small>% ' + esc(self) + '</small></span>' +
          '<span class="stat-sub">' + esc(partner) + ' ' + (partO.share * 100).toFixed(1) + '%</span></div></div>' +
        '<div class="card tight"><div class="stat">' +
          '<span class="stat-label">折合总额</span>' +
          '<span class="stat-value">' + Reporter.money(st.totalVal) + '</span>' +
          '<span class="stat-sub">' + Reporter.fmtMin(st.totalMin) + ' 隐形劳动</span></div></div>' +
      '</div>' +

      '<div class="split">' +
        '<div>' +
          '<div class="card">' +
            '<div class="card-title">分配结构 <span class="tag">分钟数占比</span></div>' +
            '<div class="sharebar">' +
              '<i class="mom" style="width:' + (selfO.share * 100) + '%"></i>' +
              '<i class="dad" style="width:' + (partO.share * 100) + '%"></i>' +
            '</div>' +
            '<div class="legend" style="margin-bottom:18px">' +
              '<span><i style="background:var(--accent)"></i>' + esc(self) + ' ' + (selfO.share * 100).toFixed(1) + '%</span>' +
              '<span><i style="background:var(--coord)"></i>' + esc(partner) + ' ' + (partO.share * 100).toFixed(1) + '%</span>' +
            '</div>' +
            '<div class="card-title" style="font-size:13px">分类别（条长 = 时长　红 = ' + esc(self) + ' / 蓝 = ' + esc(partner) + '）</div>' +
            catRows +
            '<hr class="hr">' +
            '<p class="small muted" style="margin:0">统筹 + 情绪两类合计 ' + Reporter.fmtMin(st.coEmoMin) +
            '，' + esc(self) + '承担 <strong style="color:var(--accent)">' + (st.coEmoShare * 100).toFixed(1) + '%</strong>。' +
            '这两类属于不可外包项：即使购买家政服务，也无法转移。</p>' +
          '</div>' +

          '<div class="card" style="margin-top:18px">' +
            '<div class="card-title">红榜 · 高心理负荷 <span class="tag">负荷优先 / 耗时次之</span></div>' +
            (redList ? '<ul class="rank-list">' + redList + '</ul>' :
              '<div class="empty"><b>暂无数据</b>先记录几条再来。</div>') +
          '</div>' +
        '</div>' +

        '<div>' +
          '<div class="card">' +
            '<div class="card-title">黑榜 · 未完成 / 承诺未打卡 <span class="tag">' + st.undone.length + ' 项</span></div>' +
            (blackList ? '<ul class="rank-list">' + blackList + '</ul>' :
              '<p class="small muted" style="margin:0">本期无未完成记录。</p>') +
            '<hr class="hr">' +
            '<div class="minirow"><span>伴侣在该任务上耗时为 0 的条目</span><b>' + st.zeroPartner + ' 项</b></div>' +
            '<div class="minirow"><span>心理负荷 4★ 及以上的条目</span><b>' + st.highLoad + ' 项</b></div>' +
            '<div class="minirow"><span>统筹 + 情绪两类占比（' + esc(self) + '）</span><b>' +
              (st.coEmoShare * 100).toFixed(1) + '%</b></div>' +
          '</div>' +

          '<div class="card" style="margin-top:18px">' +
            '<div class="card-title">记录明细 <span class="tag">' + st.list.length + '</span></div>' +
            (st.list.length ? '<ul class="feed">' + st.list.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map(r =>
              '<li><div class="d">' + md(r.date) + '</div>' +
              '<div class="t">' + esc(r.name) + '<em>' + r.cats.join(' + ') + '</em></div>' +
              '<div class="r">' + esc(r.owner) + ' · ' + r.minutes + "'</div></li>").join('') + '</ul>'
              : '<div class="empty"><b>无记录</b>去“记录”页输入一段话。</div>') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ============================================================
     视图四 · 周报
     ============================================================ */

  function weeklyStart() {
    const base = Reporter.weekStartOf(new Date());
    return Reporter.addDays(base, UI.weekOffset * 7);
  }

  function viewWeekly() {
    const ws = weeklyStart();
    const we = Reporter.addDays(ws, 6);
    const key = Reporter.dateKey(ws);
    const existing = S.reports.find(r => r.weekStartKey === key);
    const rep = UI.report && UI.report.weekStartKey === key ? UI.report : existing;

    const history = S.reports.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);

    return '' +
      '<div class="page-head">' +
        '<div>' +
          '<div class="kicker">Step 03 / Report</div>' +
          '<h2>家庭隐形劳动周报</h2>' +
          '<p class="lead">角色：绝对客观、冷酷无情的家庭数据 HR。禁用词库：' +
          Reporter.BANNED.slice(0, 6).join('、') + ' 等 ' + Reporter.BANNED.length + ' 个词汇。' +
          '报告生成后自动执行合规自检。</p>' +
        '</div>' +
        '<div class="row">' +
          '<button class="btn ghost sm" data-act="week" data-val="-1">‹ 上一周</button>' +
          '<span class="mono small" style="padding:0 4px">' + Reporter.dateKey(ws) + ' — ' + Reporter.dateKey(we) + '</span>' +
          '<button class="btn ghost sm" data-act="week" data-val="1">下一周 ›</button>' +
        '</div>' +
      '</div>' +

      '<div class="row no-print" style="margin-bottom:16px">' +
        '<button class="btn accent" data-act="gen-report">生成 / 刷新该周报告</button>' +
        '<button class="btn ghost" data-act="copy-report">复制全文</button>' +
        '<button class="btn ghost" data-act="download-report">下载 .md</button>' +
        '<button class="btn ghost" data-act="push-report">推送到微信</button>' +
        '<button class="btn ghost" data-act="print">打印</button>' +
      '</div>' +

      (rep ?
        (rep.lint && !rep.lint.pass ?
          '<div class="lint fail no-print">✕ 合规检查未通过：检出情绪化词汇 ' + rep.lint.hits.join('、') + '</div>' :
          '<div class="lint pass no-print">✓ 合规检查通过：0 个情绪化词汇 · 0 条建议 · 0 句安慰</div>') +
        '<div class="report-paper">' +
          '<div class="watermark">INVISIBLE LABOR LEDGER · WEEKLY DATA REPORT</div>' +
          '<pre>' + esc(rep.text) + '</pre>' +
        '</div>'
        :
        '<div class="empty"><b>本周尚未生成报告</b>' +
        '点“生成 / 刷新本周报告”。系统在每周日 21:00 打开页面时会自动生成并记录。</div>') +

      '<div class="card no-print" style="margin-top:22px">' +
        '<div class="card-title">历史周报 <span class="tag">' + S.reports.length + '</span></div>' +
        (history.length ? '<ul class="feed">' + history.map(r =>
          '<li><div class="d">' + Reporter.dateKey(new Date(r.weekStart)) + '</div>' +
          '<div class="t">' + Reporter.dateKey(new Date(r.weekStart)) + ' — ' + Reporter.dateKey(new Date(r.weekEnd)) +
            '<em>生成于 ' + new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }) + '</em></div>' +
          '<div class="r"><button class="btn ghost sm" data-act="load-report" data-id="' + r.id + '">查看</button> ' +
          '<button class="btn ghost sm" data-act="del-report" data-id="' + r.id + '">×</button></div></li>').join('') + '</ul>'
          : '<p class="small muted" style="margin:0">暂无历史报告。</p>') +
      '</div>';
  }

  /* ============================================================
     视图五 · 提示词
     ============================================================ */

  const PROMPTS = [
    {
      no: 'PROMPT 01',
      title: '生成隐形劳动词典',
      note: '用途：让模型产出全维度分类库。关键约束是“拆到环节”而非“拆到事项”——决策、下单、跟进必须分开，否则词典会退化成家务清单。',
      body:
'# 角色\n' +
'你是一位家庭社会学研究者，长期研究「看不见的劳动」（invisible labor）与「情绪劳动」（emotional labor）的计量问题。\n' +
'你不做道德评判，只做分类与计量。\n' +
'\n' +
'# 任务\n' +
'列出全职妈妈 / 职场妈妈在家庭中承担的全部「隐形劳动」与「情绪劳动」，产出一份《家庭隐形劳动分类库》。\n' +
'\n' +
'# 分类框架（必须四类，不得增删，不得新增第五类）\n' +
'1. 统筹类：为家庭运转做计划、排期、比价、协调。产出是「方案」而不是「结果」。示例：记得买纸巾、规划打疫苗时间、安排寒暑假行程。\n' +
'2. 情绪类：承接、缓冲、消化家人的情绪，维持家庭氛围的稳定。示例：安抚孩子情绪崩溃、处理婆媳边界、承接伴侣的工作情绪。\n' +
'3. 记忆类：把家庭的时间节点、库存状态、他人偏好存入自己的记忆，充当人肉数据库。示例：记住老师的生日、记下水电费缴纳日、记住孩子的鞋码。\n' +
'4. 补救类：在他人遗漏或系统失效之后进行的补位。示例：老公带娃忘带水壶，妈妈发现并送去；发现洗手液用完并补上。\n' +
'\n' +
'# 每条必须包含的字段\n' +
'- 名称：动词开头，10–18 字，具体到可执行。禁止抽象项（如「照顾孩子」「操持家务」一律不合格）。\n' +
'- 类别：四类之一；复合项写作「A+B」（如「记忆类+统筹类」）。\n' +
'- 心理负荷指数：1–5 星。评分锚点：1=几乎不占用认知；3=需要主动留意；5=持续占用注意力、不可外包、出错代价高。\n' +
'- 默认耗时（分钟）：一次完整执行的耗时中位数，必须包含任务切换成本。\n' +
'- 隐秘性说明：一句话说明它为什么不被看见，不超过 30 字。\n' +
'- 可外包性：可外包 / 部分可外包 / 不可外包。\n' +
'\n' +
'# 数量与拆分规则\n' +
'- 每类不少于 16 条，总计不少于 64 条。\n' +
'- 同一件事的不同环节必须拆开：决定买哪个牌子、下单、收货核对、退货，是四个条目。\n' +
'- 不得出现同义重复；如果两条可以用同一句话执行，合并为一条。\n' +
'\n' +
'# 输出格式\n' +
'只输出 JSON 数组，不要任何前言、解释、结语：\n' +
'[{"id":"c01","类别":"统筹类","名称":"采购清单维护与补货决策","心理负荷指数":4,"默认耗时（分钟）":20,"隐秘性说明":"判断还剩多少、何时该买，清单本身在脑子里","可外包性":"部分可外包"}]\n' +
'\n' +
'# 禁止\n' +
'禁止使用「辛苦」「伟大」「无私」「付出」「牺牲」等评价性词汇；禁止给建议；禁止抒情；禁止使用「建议」「可以尝试」等措辞。只做分类与计量。'
    },
    {
      no: 'PROMPT 02',
      title: '家庭隐形劳动分类器（语音 → JSON）',
      note: '用途：接在语音转写之后，作为系统提示词固定输出结构。要点：六字段锁定、JSON only、未提及伴侣则其耗时为 0、禁止建议与安慰。',
      body:
'你是家庭隐形劳动分类器。用户会输入一段抱怨或记录，你只负责提取其中的「隐性任务」，不做任何其他动作。\n' +
'\n' +
'# 输入\n' +
'一段口语化的家庭抱怨或流水记录，可能同时包含多件事、多处情绪宣泄。\n' +
'\n' +
'# 处理规则\n' +
'1. 按标点与连接词（然后 / 接着 / 又去 / 顺便 / 之后 / 另外）切句，一句最多产出一个任务。\n' +
'2. 纯情绪宣泄（如「今天气死我了」）不产出任务，直接丢弃。\n' +
'3. 未提及爸爸时，爸爸在该任务上的耗时一律记为 0，并写入判定理由。\n' +
'4. 耗时按一次完整执行的分钟数估算，必须包含切换成本；无法判断时按类型取默认值：统筹 20 / 情绪 25 / 记忆 10 / 补救 35。\n' +
'5. 折合家政时薪价值（元）= 预计耗时 ÷ 60 × 40，保留一位小数。\n' +
'6. 「隐形劳动判定」必须写明理由，理由要能被追责（谁漏了、漏在哪一环），不能只写「是」。\n' +
'\n' +
'# 输出格式\n' +
'必须是 JSON，不得输出任何解释、建议、安慰、总结或 Markdown 代码块以外的文字：\n' +
'{\n' +
'  "任务名称": "提醒孩子父亲交幼儿园作业",\n' +
'  "任务类型": "记忆类+统筹类",\n' +
'  "承担者": "妈妈",\n' +
'  "隐形劳动判定": "是（因为爸爸没有主动记起，需要妈妈提醒）",\n' +
'  "预计耗时（分钟）": 15,\n' +
'  "折合家政时薪价值（元）": 10\n' +
'}\n' +
'多任务时输出 JSON 数组，每项结构完全一致。\n' +
'\n' +
'# 绝对禁止\n' +
'禁止给出任何建议或安慰；禁止使用「辛苦了」「不容易」「理解」「抱抱」「加油」；禁止评价谁对谁错；禁止省略字段；禁止输出字段以外的内容。'
    },
    {
      no: 'PROMPT 03',
      title: '家庭隐形劳动周报（冷酷 HR）',
      note: '用途：每周日 21:00 自动触发。要点：只用中性词、失职必须点名到条目、结尾必须是数据反问而不是劝解。',
      body:
'你现在是一个绝对客观、冷酷无情的家庭数据 HR。你只呈现数字与事实，不做任何情绪管理。\n' +
'\n' +
'# 输入\n' +
'本周全部结构化记录，每条包含：任务名称、任务类型、承担者、隐形劳动判定、预计耗时（分钟）、折合家政时薪价值（元）、完成状态。\n' +
'\n' +
'# 输出结构（严格按顺序）\n' +
'一、数据展示\n' +
'- 妈妈本周隐形劳动总时长（小时）、折合人民币金额；爸爸同口径数值。\n' +
'- 妈妈承担的统筹类与情绪类占比（这两类为不可外包项，必须单列）。\n' +
'- 各类型（统筹 / 情绪 / 记忆 / 补救）的时长分布与双方分配率。\n' +
'\n' +
'二、失职通报\n' +
'- 列出本周爸爸承诺但未打卡、或本该发现却未发现的隐形任务，逐条点名到具体条目与日期。\n' +
'- 例：10-21「发现洗手液用完并补上」状态：未完成，承担者：爸爸。\n' +
'- 若确实没有，写「本期无未完成记录」，不得虚构。\n' +
'\n' +
'三、结论\n' +
'- 只用一行数据陈述分配率，不做归因。\n' +
'- 结尾必须附一句基于数据的反问：「基于以上数据，请问本周的家庭运转是否处于公平分配状态？」\n' +
'\n' +
'# 用词禁令\n' +
'禁止使用任何情绪化词汇，特别是：辛苦、体谅、帮忙、付出、牺牲、不容易、伟大、无私、心疼、委屈、感激、感恩、加油。\n' +
'只允许使用：完成、未完成、承担者、分配率、时长、占比、条目、状态。\n' +
'禁止出现建议句（「建议」「可以尝试」「不妨」）；禁止安慰句；禁止反问之外的任何修辞。\n' +
'\n' +
'# 格式\n' +
'纯文本，分节，数字保留一位小数，条目编号连续。不输出表格以外的修饰。'
    }
  ];

  function viewPrompts() {
    return '' +
      '<div class="page-head">' +
        '<div>' +
          '<div class="kicker">Prompt Engineering</div>' +
          '<h2>提示词</h2>' +
          '<p class="lead">三段提示词构成完整链路：先有分类库，才有分类器；先有分类器，才有周报。' +
          '顺序不可颠倒——分类库决定了什么算“一件事”，分类器决定了它记在谁头上。</p>' +
        '</div>' +
        '<div class="row"><button class="btn ghost sm" data-act="copy-all-prompts">复制全部三段</button></div>' +
      '</div>' +
      PROMPTS.map((p, i) =>
        '<div class="prompt-block">' +
          '<div class="ph">' +
            '<div><span class="no">' + p.no + '</span><h3>' + esc(p.title) + '</h3></div>' +
            '<button class="btn ghost sm" data-act="copy-prompt" data-idx="' + i + '">复制</button>' +
          '</div>' +
          '<div class="prompt-body">' + esc(p.body) + '</div>' +
          '<p class="prompt-note">' + esc(p.note) + '</p>' +
        '</div>'
      ).join('') +
      '<div class="card">' +
        '<div class="card-title">本仓库如何落地这三段提示词</div>' +
        '<dl class="kv" style="grid-template-columns:150px 1fr;gap:10px 16px">' +
          '<dt>词 典</dt><dd>内置 64 条，全部按 Prompt 01 的字段规范编写（见 <code class="mono">assets/dictionary.js</code>），可增删改。</dd>' +
          '<dt>分 类 器</dt><dd>内置规则引擎（<code class="mono">assets/parser.js</code>）实现了 Prompt 02 的六字段契约与「伴侣耗时归零」规则，离线可用、无网络依赖。</dd>' +
          '<dt>周 报</dt><dd><code class="mono">assets/report.js</code> 按 Prompt 03 生成文本，并对 ' + Reporter.BANNED.length + ' 个禁用词做自动合规检查。</dd>' +
          '<dt>接大模型</dt><dd>把 Prompt 01 / 02 / 03 原样作为系统提示词接入任意模型即可替换本地引擎；输出契约一致，无需改前端。</dd>' +
        '</dl>' +
      '</div>';
  }

  /* ============================================================
     视图六 · 设置
     ============================================================ */

  function viewSettings() {
    const s = S.settings;
    return '' +
      '<div class="page-head">' +
        '<div>' +
          '<div class="kicker">Config</div>' +
          '<h2>设置</h2>' +
          '<p class="lead">计量口径决定结论。时薪用于把时间折算成钱，成员名用于追责到人。</p>' +
        '</div>' +
      '</div>' +
      '<div class="split">' +
        '<div>' +
          '<div class="card">' +
            '<div class="card-title">计量口径</div>' +
            '<div class="grid g2">' +
              '<div class="field"><label>记录者（被计量者）</label><input type="text" data-set="self" value="' + esc(s.self) + '"></div>' +
              '<div class="field"><label>对方（对照组）</label><input type="text" data-set="partner" value="' + esc(s.partner) + '"></div>' +
            '</div>' +
            '<div class="grid g2">' +
              '<div class="field"><label>孩子称呼</label><input type="text" data-set="child" value="' + esc(s.child) + '"></div>' +
              '<div class="field"><label>家政时薪（元/小时）</label><input type="number" data-set="wage" value="' + s.wage + '" min="1"></div>' +
            '</div>' +
            '<p class="small muted" style="margin:0">口径说明：折合金额 = 分钟 ÷ 60 × 时薪。该数值不是工资主张，而是把不可见的注意力占用换算成可比较的单位。</p>' +
          '</div>' +

          '<div class="card" style="margin-top:18px">' +
            '<div class="card-title">自动周报</div>' +
            '<div class="row" style="margin-bottom:14px">' +
              '<label class="row" style="gap:8px;cursor:pointer">' +
                '<input type="checkbox" data-set="autoReport" ' + (s.autoReport ? 'checked' : '') + ' style="width:auto">' +
                '<span class="small">每周日 21:00 打开本页时自动生成并归档</span>' +
              '</label>' +
            '</div>' +
            '<div class="field"><label>推送渠道</label>' +
              '<select data-set="pushType">' +
                '<option value="none"' + (s.push.type === 'none' ? ' selected' : '') + '>不推送（仅本地归档）</option>' +
                '<option value="wecom"' + (s.push.type === 'wecom' ? ' selected' : '') + '>企业微信群机器人 Webhook</option>' +
                '<option value="serverchan"' + (s.push.type === 'serverchan' ? ' selected' : '') + '>Server 酱 SendKey（推送到微信）</option>' +
              '</select>' +
            '</div>' +
            '<div class="field"><label>Webhook 地址 / SendKey</label>' +
              '<input type="text" data-set="pushUrl" value="' + esc(s.push.url) + '" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=... 或 SCTxxxxx">' +
            '</div>' +
            '<p class="small muted" style="margin:0">浏览器直连受限时可能被 CORS 拦截，失败会明确报错。真实定时推送需配合云端函数（见 README）。</p>' +
          '</div>' +
        '</div>' +

        '<div>' +
          installCard() +
          '<div class="card" style="margin-top:18px">' +
            '<div class="card-title">数据</div>' +
            '<div class="row" style="margin-bottom:10px">' +
              '<button class="btn ghost sm" data-act="export-json">导出 JSON</button>' +
              '<button class="btn ghost sm" data-act="export-csv">导出 CSV</button>' +
              '<button class="btn ghost sm" data-act="import">导入</button>' +
            '</div>' +
            '<div class="row">' +
              '<button class="btn ghost sm" data-act="demo">载入演示数据</button>' +
              '<button class="btn ghost sm" data-act="clear">清空全部</button>' +
            '</div>' +
            '<input type="file" id="fileimport" accept=".json" style="display:none">' +
            '<hr class="hr">' +
            '<div class="grid g3" style="gap:10px">' +
              '<div class="stat"><span class="stat-label">记录</span><span class="stat-value" style="font-size:20px">' + S.records.length + '</span></div>' +
              '<div class="stat"><span class="stat-label">周报</span><span class="stat-value" style="font-size:20px">' + S.reports.length + '</span></div>' +
              '<div class="stat"><span class="stat-label">自定义条目</span><span class="stat-value" style="font-size:20px">' + S.customDict.length + '</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="card dark" style="margin-top:18px">' +
            '<div class="card-title" style="color:var(--paper)">使用说明</div>' +
            '<p class="small" style="color:rgba(245,242,234,.82);line-height:1.9;margin:0">' +
            '1. 先用「记录」页把一周的抱怨转成条目，越具体越好。<br>' +
            '2. 状态选择决定黑榜：<b>未完成</b> = 承诺了没做；<b>承诺未打卡</b> = 做了但没被记录。<br>' +
            '3. 周报只陈述数字，不做劝解。它的用途是对话入口，不是结论。<br>' +
            '4. 数据只存在于本机浏览器，清空缓存即消失——请定期导出。</p>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ============================================================
     交互
     ============================================================ */

  let recog = null;
  let listening = false;

  function initMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      const b = $('#micbtn');
      if (b) { b.setAttribute('disabled', 'true'); b.style.opacity = '.5'; }
      const st = $('#micstat');
      if (st) st.textContent = '当前浏览器不支持语音识别，请用文字输入';
      return;
    }
    recog = new SR();
    recog.lang = 'zh-CN';
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = e => {
      let txt = '';
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      const ta = $('#raw');
      if (ta) { ta.value = txt; UI.raw = txt; }
    };
    recog.onerror = e => {
      const st = $('#micstat');
      if (st) st.textContent = '识别中断：' + (e.error || 'unknown');
      stopMic();
    };
    recog.onend = () => stopMic();
  }

  function startMic() {
    if (!recog) { initMic(); if (!recog) return; }
    try {
      recog.start();
      listening = true;
      const b = $('#micbtn');
      if (b) { b.classList.add('rec'); }
      const l = $('#miclabel'); if (l) l.textContent = '正在听…（点击停止）';
      const st = $('#micstat'); if (st) st.textContent = '';
    } catch (err) { /* 已在录音中 */ }
  }

  function stopMic() {
    listening = false;
    const b = $('#micbtn');
    if (b) b.classList.remove('rec');
    const l = $('#miclabel'); if (l) l.textContent = '语音输入';
    try { recog && recog.stop(); } catch (e) {}
  }

  function afterRender() {
    if (UI.view === 'capture') initMic();
  }

  /* ---- 全局委托 ---- */

  document.addEventListener('click', e => {
    const nav = e.target.closest('#tabs a');
    if (nav) return; // 交给 hash 路由

    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;

    switch (act) {
      /* 词典 */
      case 'dictCat': UI.dictCat = el.dataset.val; render(); break;
      case 'dictStar': UI.dictStar = Number(el.dataset.val); render(); break;
      case 'toggle-add': UI.showAdd = !UI.showAdd; render(); break;
      case 'add-dict': {
        const name = ($('#nd-name') || {}).value || '';
        if (!name.trim()) { toast('请填写条目名称'); return; }
        S.customDict.push({
          id: 'u' + Date.now().toString(36),
          cat: $('#nd-cat').value,
          name: name.trim(),
          star: Number($('#nd-star').value),
          min: Number($('#nd-min').value) || 20,
          kw: [name.trim().slice(0, 4)],
          note: ($('#nd-note') || {}).value || '自定义条目'
        });
        save(); UI.showAdd = false; render(); toast('已加入词典');
        break;
      }
      case 'prefill': {
        const n = el.dataset.name;
        UI.raw = n + '（补一句当时的经过）';
        location.hash = '#/capture';
        render();
        const ta = $('#raw'); if (ta) ta.focus();
        break;
      }

      /* 记录 */
      case 'sample': {
        const ta = $('#raw');
        if (ta) { ta.value = '今天气死我了，我刚安抚完娃，又去提醒他爸明天要交幼儿园手工作业'; UI.raw = ta.value; }
        break;
      }
      case 'mic': {
        if (listening) stopMic(); else startMic();
        break;
      }
      case 'parse': {
        const ta = $('#raw');
        const text = ta ? ta.value.trim() : '';
        if (!text) { toast('先输入一段文字'); return; }
        const r = Parser.parse(text, {
          self: S.settings.self, partner: S.settings.partner,
          child: S.settings.child, wage: S.settings.wage
        });
        UI.parsed = r.tasks;
        UI.dropped = r.dropped;
        render();
        if (!r.tasks.length) toast('未提取到任务，试着写得更具体');
        break;
      }
      case 'drop-parsed': UI.parsed.splice(Number(el.dataset.idx), 1); render(); break;
      case 'clear-parsed': UI.parsed = []; UI.dropped = []; render(); break;
      case 'copy-json': {
        const spec = UI.parsed.map(t => Parser.toSpecJson(t));
        copy(spec.length === 1 ? JSON.stringify(spec[0], null, 2) : JSON.stringify(spec, null, 2), 'JSON 已复制');
        break;
      }
      case 'save-all': {
        if (!UI.parsed.length) return;
        UI.parsed.forEach(t => S.records.push(t));
        save();
        const n = UI.parsed.length;
        UI.parsed = []; UI.dropped = [];
        render(); toast('已入账 ' + n + ' 条');
        break;
      }
      case 'del-rec': {
        S.records = S.records.filter(r => r.id !== el.dataset.id);
        save(); render(); toast('已删除');
        break;
      }

      /* 看板 */
      case 'period': UI.period = el.dataset.val; render(); break;

      /* 周报 */
      case 'week': UI.weekOffset += Number(el.dataset.val); render(); break;
      case 'gen-report': genReport(weeklyStart()); break;
      case 'copy-report': {
        const r = currentReport();
        if (r) copy(r.text, '周报已复制');
        else toast('请先生成');
        break;
      }
      case 'download-report': {
        const r = currentReport();
        if (r) download('家庭隐形劳动周报_' + r.weekStartKey + '.md', r.text, 'text/markdown');
        else toast('请先生成');
        break;
      }
      case 'push-report': pushReport(); break;
      case 'print': window.print(); break;
      case 'load-report': {
        const r = S.reports.find(x => x.id === el.dataset.id);
        if (r) {
          UI.weekOffset = Math.round((Reporter.weekStartOf(new Date(r.weekStart)) - Reporter.weekStartOf(new Date())) / 604800000);
          UI.report = r;
          render();
        }
        break;
      }
      case 'del-report': {
        S.reports = S.reports.filter(x => x.id !== el.dataset.id);
        save(); render(); toast('已删除周报');
        break;
      }

      /* 提示词 */
      case 'copy-prompt': copy(PROMPTS[Number(el.dataset.idx)].body, '提示词已复制'); break;
      case 'copy-all-prompts': copy(PROMPTS.map(p => p.title + '\n\n' + p.body).join('\n\n---\n\n'), '三段提示词已复制'); break;

      /* 设置 */
      case 'install': {
        if (!deferredPrompt) { toast('请用浏览器菜单里的「安装应用」'); break; }
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (res) {
          if (res && res.outcome === 'accepted') toast('正在安装');
          deferredPrompt = null;
          render();
        }).catch(function () { deferredPrompt = null; render(); });
        break;
      }
      case 'copy-link': copy(siteURL(), '链接已复制'); break;
      case 'export-json': download('隐形劳动账本_备份.json', JSON.stringify(S, null, 2), 'application/json'); break;
      case 'export-csv': exportCSV(); break;
      case 'import': { const f = $('#fileimport'); if (f) f.click(); break; }
      case 'demo': loadDemo(); break;
      case 'clear': {
        if (confirm('将清空全部记录、周报与自定义条目，不可恢复。继续？')) {
          S = freshState(); save(); UI.parsed = []; UI.report = null; render(); toast('已清空');
        }
        break;
      }
    }
  });

  document.addEventListener('input', e => {
    const t = e.target;

    if (t.id === 'q') {
      UI.q = t.value;
      const pos = t.selectionStart;
      render();
      const q2 = $('#q');
      if (q2) { q2.focus(); q2.setSelectionRange(pos, pos); }
      return;
    }
    if (t.id === 'raw') { UI.raw = t.value; return; }

    if (t.dataset.edit === 'min') {
      const i = Number(t.dataset.idx);
      const v = Math.max(1, Number(t.value) || 1);
      UI.parsed[i].minutes = v;
      UI.parsed[i].value = Math.round(v / 60 * S.settings.wage * 10) / 10;
      const dd = t.closest('dd');
      const valDd = dd && dd.nextElementSibling;
      if (valDd) valDd.textContent = Reporter.money(UI.parsed[i].value);
      return;
    }

    if (t.dataset.set) {
      const k = t.dataset.set;
      if (k === 'pushType') S.settings.push.type = t.value;
      else if (k === 'pushUrl') S.settings.push.url = t.value;
      else if (k === 'wage') S.settings.wage = Math.max(1, Number(t.value) || 40);
      else if (k === 'autoReport') S.settings.autoReport = !!t.checked;
      else if (k === 'reportHour') S.settings.reportHour = Number(t.value) || 21;
      else S.settings[k] = t.value;
      save();
      return;
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.edit === 'status') {
      UI.parsed[Number(t.dataset.idx)].status = t.value;
    }
    if (t.dataset.set === 'autoReport' || t.dataset.set === 'pushType') {
      const k = t.dataset.set;
      if (k === 'autoReport') S.settings.autoReport = t.checked;
      if (k === 'pushType') S.settings.push.type = t.value;
      save();
    }
    if (t.id === 'fileimport' && t.files && t.files[0]) {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const obj = JSON.parse(fr.result);
          if (obj.records) {
            S.records = obj.records;
            if (obj.settings) S.settings = Object.assign(S.settings, obj.settings);
            if (obj.customDict) S.customDict = obj.customDict;
            if (obj.reports) S.reports = obj.reports;
            save(); render(); toast('导入成功');
          } else toast('文件格式不符');
        } catch (err) { toast('解析失败'); }
      };
      fr.readAsText(t.files[0]);
    }
  });

  /* ---- 功能函数 ---- */

  function copy(text, msg) {
    const done = () => toast(msg || '已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  }

  function download(name, content, mime) {
    const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function exportCSV() {
    const head = ['日期', '任务名称', '任务类型', '承担者', '隐形劳动判定', '预计耗时（分钟）', '折合价值（元）', '心理负荷', '状态'];
    const rows = S.records.map(r => [
      Reporter.dateKey(r.date), r.name, r.cats.join('+'), r.owner,
      (r.judged || '').replace(/[",\n]/g, ' '), r.minutes, r.value, r.star,
      r.status === 'done' ? '完成' : (r.status === 'promised' ? '承诺未打卡' : '未完成')
    ]);
    const csv = '\uFEFF' + [head].concat(rows).map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
    download('隐形劳动记录_' + Reporter.dateKey(new Date()) + '.csv', csv, 'text/csv');
  }

  function genReport(start) {
    const rep = Reporter.build(S.records, S.settings, start);
    const obj = {
      id: 'r' + Date.now().toString(36),
      weekStartKey: Reporter.dateKey(rep.stats.weekStart),
      weekStart: rep.stats.weekStart.toISOString(),
      weekEnd: rep.stats.weekEnd.toISOString(),
      text: rep.text,
      lint: rep.lint,
      createdAt: new Date().toISOString()
    };
    S.reports = S.reports.filter(r => r.weekStartKey !== obj.weekStartKey);
    S.reports.push(obj);
    save();
    UI.report = obj;
    UI.weekOffset = Math.round(
      (Reporter.weekStartOf(new Date(rep.stats.weekStart)) - Reporter.weekStartOf(new Date())) / 604800000
    );
    render();
    toast('周报已生成 · ' + (rep.lint.pass ? '合规通过' : '检出禁用词'));
    return obj;
  }

  function currentReport() {
    const key = Reporter.dateKey(weeklyStart());
    return (UI.report && UI.report.weekStartKey === key ? UI.report : null) ||
      S.reports.find(r => r.weekStartKey === key);
  }

  function pushReport() {
    const r = currentReport();
    if (!r) { toast('请先生成周报'); return; }
    const p = S.settings.push;
    if (!p || p.type === 'none' || !p.url) { toast('请先在设置里配置推送渠道'); return; }

    if (p.type === 'wecom') {
      fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: r.text } })
      }).then(() => toast('已发送到企业微信'))
        .catch(() => toast('推送失败：可能被 CORS 拦截，请用云端函数转发'));
    } else {
      const url = 'https://sctapi.ftqq.com/' + encodeURIComponent(p.url) + '.send?title=' +
        encodeURIComponent('家庭隐形劳动周报 ' + r.weekStartKey) + '&desp=' + encodeURIComponent(r.text);
      fetch(url).then(() => toast('已推送到微信'))
        .catch(() => toast('推送失败：请检查 SendKey 或网络'));
    }
  }

  /* ---- 自动周报：周日 21:00 ---- */
  function checkAutoReport() {
    if (!S.settings.autoReport) return;
    const now = new Date();
    if (now.getDay() !== 0) return;
    if (now.getHours() < (S.settings.reportHour || 21)) return;
    const key = Reporter.dateKey(Reporter.weekStartOf(now));
    if (S.reports.some(r => r.weekStartKey === key)) return;
    if (!S.records.length) return;
    genReport(Reporter.weekStartOf(now));
    setTimeout(() => { if (S.settings.push.type !== 'none') pushReport(); }, 800);
  }

  /* ---- 演示数据 ---- */
  function loadDemo() {
    const base = new Date();
    const samples = [
      '今天气死我了，我刚安抚完娃，又去提醒他爸明天要交幼儿园手工作业',
      '早上发现洗手液用完了，顺手在群里买了三瓶，还要记得提醒他爸取快递',
      '带娃去医院挂号，排了两个小时的队，回来还要给他爸解释为什么又是我请假',
      '晚上哄睡哄了四十分钟，厨房的碗还堆着，没人认领',
      '他爸带娃出门忘带水壶，我打车送过去，来回四十分钟'
    ];
    const out = [];
    samples.forEach((txt, d) => {
      const day = Reporter.addDays(base, -d);
      day.setHours(20, 0, 0, 0);
      const r = Parser.parse(txt, {
        self: S.settings.self, partner: S.settings.partner,
        child: S.settings.child, wage: S.settings.wage, date: day.toISOString()
      });
      r.tasks.forEach((t, i) => {
        if (d === 3 && i === 0) t.status = 'promised';
        if (d === 4 && i === 0) { t.owner = S.settings.partner; t.partnerMinutes = t.minutes; }
        out.push(t);
      });
    });
    // 一条爸爸的未完成记录，用于演示黑榜
    out.push({
      id: 'demo-x', date: Reporter.addDays(base, -2).toISOString(),
      raw: '洗手液用完', name: '发现洗手液用完并补上',
      cats: ['补救类', '记忆类'], catKeys: ['fix', 'mem'],
      owner: S.settings.partner, judged: '是（该发现未发现，最终由记录者补位）',
      invisible: true, minutes: 10, value: Math.round(10 / 60 * S.settings.wage * 10) / 10,
      partnerMinutes: 10, partnerMentioned: true, star: 2, dictId: 'f03', status: 'undone'
    });
    S.records = S.records.concat(out);
    save(); render(); toast('已载入 ' + out.length + ' 条演示记录');
  }

  /* ---- 启动 ---- */
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    route();
    checkAutoReport();
    setInterval(checkAutoReport, 60000);
    registerSW();
    maybeInstallHint();
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    navigator.serviceWorker.register('sw.js').catch(function () { /* 离线缓存不可用不影响主功能 */ });
  }

  /* 手机首次打开时提示一次：怎么装到桌面 */
  function maybeInstallHint() {
    if (isStandalone()) return;
    try { if (localStorage.getItem('ill.installHint')) return; } catch (e) { return; }
    if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    setTimeout(function () {
      toast(isAndroid()
        ? '想装到桌面？Chrome 右上角 ⋮ → 安装应用'
        : '想装到桌面？Safari 分享 → 添加到主屏幕');
      try { localStorage.setItem('ill.installHint', '1'); } catch (e) {}
    }, 2600);
  }

  window.addEventListener('hashchange', route);
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
