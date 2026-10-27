/* ============================================================
   周报引擎 · Weekly Report Engine
   角色设定：绝对客观、冷酷无情的家庭数据 HR。
   禁止词库用于自检：任何情绪化词汇都会让报告不合规。
   ============================================================ */

const Reporter = (function () {

  const BANNED = ['辛苦', '体谅', '帮忙', '付出', '牺牲', '不容易', '伟大', '无私',
    '心酸', '委屈', '心疼', '感激', '感谢', '感恩', '加油', '抱抱', '辛苦了',
    '建议', '希望', '应该多', '尝试', '不妨', '理解一下'];

  const CAT_ORDER = ['coord', 'emo', 'mem', 'fix'];
  const CAT_NAME = { coord: '统筹类', emo: '情绪类', mem: '记忆类', fix: '补救类' };

  /* ---------- 日期 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function dateKey(d) {
    const x = new Date(d);
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }

  function weekStartOf(d) {
    const x = new Date(d);
    const day = x.getDay();               // 0=周日
    const diff = (day === 0 ? -6 : 1 - day);
    x.setDate(x.getDate() + diff);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function fmtMin(m) {
    const h = Math.floor(m / 60);
    const mm = Math.round(m % 60);
    if (h === 0) return mm + ' 分钟';
    return h + ' 小时' + (mm ? ' ' + mm + ' 分' : '');
  }

  function pct(a, b) {
    if (!b) return '0.0%';
    return (a / b * 100).toFixed(1) + '%';
  }

  function money(v) { return '¥' + (Math.round(v * 10) / 10).toFixed(1); }

  /* ---------- 纯文本对齐（中文按 2 个字符宽计算） ---------- */
  function dw(s) {
    let n = 0;
    for (const ch of String(s)) n += ch.codePointAt(0) > 0x2e80 ? 2 : 1;
    return n;
  }
  function padTo(s, w) {
    s = String(s);
    const d = dw(s);
    return d >= w ? s : s + ' '.repeat(w - d);
  }
  function trow(cells, widths) {
    return cells.map((c, i) => (i === cells.length - 1 ? String(c) : padTo(c, widths[i] || 0))).join('');
  }

  /* ---------- 统计 ---------- */
  function summarize(records, settings, weekStart, spanDays) {
    const span = spanDays || 7;
    const start = weekStartOf(weekStart || new Date());
    const end = addDays(start, span);
    const self = settings.self || '妈妈';
    const partner = settings.partner || '爸爸';

    const list = records.filter(r => {
      const t = new Date(r.date);
      return t >= start && t < end;
    });

    const byOwner = {};
    [self, partner].forEach(n => {
      byOwner[n] = { name: n, min: 0, val: 0, count: 0, byCat: {} };
      CAT_ORDER.forEach(c => byOwner[n].byCat[c] = 0);
    });

    const catTotals = {};
    CAT_ORDER.forEach(c => catTotals[c] = { min: 0, count: 0, selfMin: 0, partnerMin: 0 });

    let totalMin = 0, totalVal = 0;
    let highLoad = 0, highSelf = 0, highPartner = 0;
    let zeroPartner = 0, partnerMentioned = 0;

    list.forEach(r => {
      const owner = byOwner[r.owner] ? r.owner : self;
      const min = Number(r.minutes) || 0;
      const val = Number(r.value) || 0;

      byOwner[owner].min += min;
      byOwner[owner].val += val;
      byOwner[owner].count += 1;

      const cats = (r.catKeys && r.catKeys.length) ? r.catKeys : ['coord'];
      cats.forEach(c => {
        if (!catTotals[c]) return;
        catTotals[c].min += min;
        catTotals[c].count += 1;
        if (owner === self) { catTotals[c].selfMin += min; byOwner[self].byCat[c] += min; }
        else { catTotals[c].partnerMin += min; byOwner[partner].byCat[c] += min; }
      });

      totalMin += min;
      totalVal += val;

      if ((r.star || 3) >= 4) {
        highLoad += 1;
        if (owner === self) highSelf += 1; else highPartner += 1;
      }
      if (!r.partnerMinutes) zeroPartner += 1;
      if (r.partnerMentioned) partnerMentioned += 1;
    });

    [self, partner].forEach(n => {
      byOwner[n].share = totalMin ? byOwner[n].min / totalMin : 0;
    });

    const coEmoMin = catTotals.coord.min + catTotals.emo.min;
    const coEmoSelf = catTotals.coord.selfMin + catTotals.emo.selfMin;

    return {
      weekStart: start, weekEnd: addDays(start, span - 1), spanDays: span,
      list, self, partner,
      totalMin, totalVal, totalCount: list.length,
      byOwner, catTotals,
      coEmoShare: coEmoMin ? coEmoSelf / coEmoMin : 0,
      coEmoMin, coEmoSelf,
      highLoad, highSelf, highPartner,
      zeroPartner, partnerMentioned,
      undone: list.filter(r => r.status === 'undone' || r.status === 'promised'),
      gap: byOwner[partner].share
    };
  }

  /* ---------- 报告文本 ---------- */
  function build(records, settings, weekStart) {
    const s = summarize(records, settings, weekStart);
    const L = [];
    const line = (t) => L.push(t);

    line('【家庭隐形劳动周报】');
    line('统计区间 ' + dateKey(s.weekStart) + ' — ' + dateKey(s.weekEnd) + '（周一至周日）');
    line('数据来源 家庭隐形劳动账本 · 结构化记录 ' + s.totalCount + ' 条');
    line('生成时间 ' + new Date().toLocaleString('zh-CN', { hour12: false }));
    line('————————————————————————');
    line('');

    if (s.totalCount === 0) {
      line('本周结构化记录 0 条。');
      line('');
      line('无数据状态下不产生分配率结论。请先完成记录，再执行统计。');
      line('');
      line('基于以上数据，请问本周的家庭运转是否处于公平分配状态？');
      return finish(L, s);
    }

    line('一、总量');
    const W1 = [12, 16, 12, 10];
    line(trow(['承担者', '时长', '折合金额', '任务数', '分配率'], W1));
    [s.self, s.partner].forEach(n => {
      const o = s.byOwner[n];
      line(trow([n, fmtMin(o.min), money(o.val), o.count + ' 项', pct(o.min, s.totalMin)], W1));
    });
    line(trow(['合计', fmtMin(s.totalMin), money(s.totalVal), s.totalCount + ' 项', '100.0%'], W1));
    line('');

    line('二、结构分布');
    const W2 = [10, 18, 18];
    line(trow(['类型', s.self, s.partner, s.self + '占比'], W2));
    CAT_ORDER.forEach(c => {
      const ct = s.catTotals[c];
      const tot = ct.min;
      line(trow([CAT_NAME[c], fmtMin(ct.selfMin), fmtMin(ct.partnerMin), pct(ct.selfMin, tot)], W2));
    });
    line('');
    line('统筹 + 情绪（不可外包的两类）合计 ' + fmtMin(s.coEmoMin) + '，' + s.self + '承担 ' +
      pct(s.coEmoSelf, s.coEmoMin) + '。');
    line('');

    line('三、隐形程度');
    line('心理负荷 4★ 及以上任务 ' + s.highLoad + ' 项：' + s.self + ' ' + s.highSelf + ' 项，' +
      s.partner + ' ' + s.highPartner + ' 项。');
    line('伴侣耗时为 0 的任务 ' + s.zeroPartner + ' 项（占 ' + pct(s.zeroPartner, s.totalCount) + '）。');
    line('本周提及伴侣的记录 ' + s.partnerMentioned + ' 条。');
    line('');

    line('四、未完成与未发现（通报）');
    if (s.undone.length === 0) {
      line('本期无未完成记录。');
    } else {
      s.undone.forEach((r, i) => {
        const tag = (r.status === 'promised' ? '承诺未打卡' : '未完成') +
          ((r.catKeys || []).indexOf('fix') !== -1 ? ' · 该发现未发现' : '');
        line((i + 1) + '. ' + dateKey(r.date).slice(5) + ' 「' + r.name + '」 承担者：' + r.owner +
          ' 状态：' + tag + ' 判定：' + (r.judged || '').replace(/^是（|）$/g, ''));
      });
    }
    line('');
    line('五、结论');
    line('分配率：' + s.self + ' ' + pct(s.byOwner[s.self].min, s.totalMin) + ' / ' +
      s.partner + ' ' + pct(s.byOwner[s.partner].min, s.totalMin) + '。');
    line('上述比例与双方可支配时间的比例进行对照，即可判定分配是否成立。');
    line('');
    line('基于以上数据，请问本周的家庭运转是否处于公平分配状态？');

    return finish(L, s);
  }

  function finish(lines, stats) {
    const text = lines.join('\n');
    return { text, stats, lint: lint(text) };
  }

  /* ---------- 合规自检 ---------- */
  function lint(text) {
    const hits = BANNED.filter(w => text.indexOf(w) !== -1);
    return { pass: hits.length === 0, hits };
  }

  /* ---------- 微信推送体（纯文本/Markdown） ---------- */
  function toWecom(report) {
    return report.text;
  }

  return { build, summarize, lint, dateKey, weekStartOf, addDays, fmtMin, pct, money, BANNED, CAT_NAME, CAT_ORDER };
})();

if (typeof window !== 'undefined') window.Reporter = Reporter;
