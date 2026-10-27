/* ============================================================
   隐形劳动分类器 · Invisible Labor Classifier
   纯前端规则引擎：把一段抱怨 / 记录，切分为结构化任务。
   设计原则（与系统提示词一致）：
     1. 只输出结构化数据，不输出建议、不安慰、不评判。
     2. 未提及伴侣时，伴侣在该任务上的耗时记为 0。
     3. 每一条都给出“隐形劳动判定”的理由，理由必须可被追责。
   ============================================================ */

const Parser = (function () {

  const CAT_LABEL = { coord: '统筹类', emo: '情绪类', mem: '记忆类', fix: '补救类' };
  const LABEL_KEY = { '统筹类': 'coord', '情绪类': 'emo', '记忆类': 'mem', '补救类': 'fix' };

  /* ---------- 关键词索引：长词优先 ---------- */
  const KW_INDEX = [];
  (typeof DICT !== 'undefined' ? DICT : []).forEach(it => {
    (it.kw || []).forEach(k => KW_INDEX.push({ k, it }));
  });
  KW_INDEX.sort((a, b) => b.k.length - a.k.length);

  function matchDict(text) {
    for (const e of KW_INDEX) {
      if (text.indexOf(e.k) !== -1) return e.it;
    }
    return null;
  }

  /* ---------- 切句 ---------- */
  const PUNCT = /[，,。；;！!？?、\n\r\t]+/;
  const CONNECT = /然后|接着|之后|后来|另外|还有|顺便|于是|同时|再然后|结果|最后|又去|又得|又跑|又发现|又要|又开始/;

  function splitClauses(text) {
    return String(text || '')
      .replace(/[。！？!?]/g, '，')
      .split(PUNCT)
      .reduce((acc, seg) => acc.concat(seg.split(CONNECT)), [])
      .map(s => s.trim())
      .filter(s => s.length >= 2);
  }

  /* ---------- 纯情绪句（不产生任务） ---------- */
  const EMOTION_ONLY = /^(今天|真的|我|真是)?\s*(气死|累死|烦死|崩了|崩溃|无语|受够|受不了|太累|好累|心累|快疯|服了|恶心)/;
  const TASK_VERB = /(提醒|安抚|哄|买|记|送|接|交|缴|安排|规划|预约|挂号|收拾|整理|补|发现|联系|沟通|说|做|陪|带|处理|解释|道歉|查|抢|订|报|跑|弄|搞|准备|盯|等|改|换|洗|煮|做)/;

  /* ---------- 时长解析 ---------- */
  const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };

  function parseDuration(clause) {
    let m = clause.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:小时|钟头|h|H)/);
    if (m) return Math.round(parseFloat(m[1]) * 60);
    m = clause.match(/(\d+)\s*(?:分钟|分|min)/);
    if (m) return parseInt(m[1], 10);
    m = clause.match(/([一二两三四五六七八九十半])\s*(?:个)?\s*(?:小时|钟头)/);
    if (m) return Math.round(CN_NUM[m[1]] * 60);
    m = clause.match(/([一二两三四五六七八九十])\s*(?:分钟|分)/);
    if (m) return Math.round(CN_NUM[m[1]]);
    if (/半(?:个)?(?:小时|钟头)/.test(clause)) return 30;
    if (/(一整天|整个下午|整个上午|一上午|一下午)/.test(clause)) return 180;
    return 0;
  }

  /* ---------- 工具 ---------- */
  function clean(s) {
    return String(s || '')
      .replace(/^[的地得了着过就都还也才又再刚已经正在把被给对向从和跟与及]+/, '')
      .replace(/[的了着过呢吧啊呀嘛哈哦噢]+$/, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function trimLen(s, n) {
    s = clean(s);
    return s.length > n ? s.slice(0, n) : s;
  }

  const PARTNER = /(他爸|他爹|爸爸|老公|先生|孩子他爸|娃他爸|他妈|她爸|另一半|队友)/;

  /* ---------- 规则表：顺序即优先级 ---------- */
  const RULES = [
    /* 1. 提醒伴侣 —— 记忆类 + 统筹类 */
    {
      re: /(?:提醒|催|叫|喊|告诉|通知)\s*(他爸|他爹|爸爸|老公|先生|孩子他爸|她爸|另一半|队友)?\s*(明天|后天|今天|今晚|下周|这周|周一|周二|周三|周四|周五|周六|周日|周末)?\s*(?:要|该|去|记得|别忘了?)?\s*(.+)/,
      build(m, ctx) {
        const who = m[1] || ctx.partner;
        const when = m[2] || '';
        const obj = trimLen(m[3], 18);
        return {
          name: `提醒${who}${when}${obj}`,
          cats: ['记忆类', '统筹类'],
          minutes: 15,
          reason: `${who}未主动记起，需${ctx.self}前置提醒并跟进确认`
        };
      }
    },
    /* 2. 安抚 / 哄 / 安慰 —— 情绪类 */
    {
      re: /(安抚|哄|安慰|开导|劝|抱住|陪睡|哄睡)(?:完|着|一下|着睡)?\s*(.{0,14})/,
      build(m, ctx) {
        const verb = m[1], obj = trimLen(m[2], 14) || ctx.child;
        return {
          name: `${verb}${obj}`,
          cats: ['情绪类'],
          minutes: 25,
          reason: `${obj}的情绪无人分担，由${ctx.self}承接并消化`
        };
      }
    },
    /* 3. 发现遗漏并补位 —— 补救类 + 记忆类 */
    {
      re: /(发现|看到|注意到|察觉)(.{2,16}?)(用完|没了|空了|不够|过期|坏了|漏了)(.{0,8})/,
      build(m, ctx) {
        const what = trimLen(m[2], 14), state = m[3];
        return {
          name: `发现${what}${state}并处理`,
          cats: ['补救类', '记忆类'],
          minutes: 10,
          reason: `库存状态无人监测，${ctx.self}事后发现并补位`
        };
      }
    },
    /* 4. 忘带 / 漏带 → 由一人补送 —— 补救类 */
    {
      re: /(忘带|漏带|没带|忘拿|落在家|落在家里)(.{1,12})/,
      build(m, ctx) {
        const obj = trimLen(m[2], 14);
        return {
          name: `补送${obj}`,
          cats: ['补救类'],
          minutes: 35,
          reason: `他人遗漏在前，${ctx.self}事后跑动补位`
        };
      }
    },
    /* 5. 预约 / 挂号 / 抢号 —— 统筹类 */
    {
      re: /(预约|挂号|抢号|约号|约课|约车|陪诊)(.{0,14})/,
      build(m) {
        return {
          name: `${m[1]}${trimLen(m[2], 14)}`,
          cats: ['统筹类'],
          minutes: 30,
          reason: `需要前置查证与抢位，无人主动分担`
        };
      }
    },
    /* 6. 缴 / 交（费用、作业） —— 记忆类 + 统筹类 */
    {
      re: /(交|缴|充)(.{0,12}?(?:费|学费|班费|水电|燃气|物业|作业|手工))/,
      build(m) {
        const obj = trimLen(m[2], 16);
        return {
          name: `处理${obj}`,
          cats: ['记忆类', '统筹类'],
          minutes: 15,
          reason: `该节点无人在计划表中登记，由一人代持`
        };
      }
    },
    /* 7. 安排 / 规划 / 协调 —— 统筹类 */
    {
      re: /(安排|规划|计划|协调|联系|沟通|调度|排)(.{1,16})/,
      build(m) {
        return {
          name: `${m[1]}${trimLen(m[2], 16)}`,
          cats: ['统筹类'],
          minutes: 25,
          reason: `方案由一人制定，其余人只执行结果`
        };
      }
    },
    /* 8. 买 / 下单 / 囤 —— 统筹类 + 记忆类 */
    {
      re: /(买|购|下单|囤|补货|订)(.{1,16})/,
      build(m) {
        return {
          name: `${m[1]}${trimLen(m[2], 16)}`,
          cats: ['统筹类', '记忆类'],
          minutes: 15,
          reason: `需求由一人监测、决策并执行`
        };
      }
    },
    /* 9. 记住 / 记得 —— 记忆类 */
    {
      re: /(记得|记住|记下|想着|别忘|要想起来|记着)(.{0,16})/,
      build(m) {
        return {
          name: `记住${trimLen(m[2], 16)}`,
          cats: ['记忆类'],
          minutes: 10,
          reason: `该信息只存在于一人的记忆中，无外部备份`
        };
      }
    },
    /* 10. 做 / 赶 / 补（作业、手工） —— 补救类 */
    {
      re: /(做|赶|补|画|包)(.{0,10}?(?:作业|手工|辅食|便当|蛋糕|礼物|贺卡))/,
      build(m) {
        return {
          name: `${m[1]}${trimLen(m[2], 16)}`,
          cats: ['补救类'],
          minutes: 45,
          reason: `截止时间临近才被启动，执行者临时补位`
        };
      }
    },
    /* 11. 收拾 / 整理 / 补上 —— 补救类 */
    {
      re: /(收拾|整理|清理|补上|换上|补充|洗)(.{0,14})/,
      build(m, ctx) {
        return {
          name: `${m[1]}${trimLen(m[2], 14) || '家庭公共事务'}`,
          cats: ['补救类'],
          minutes: 20,
          reason: `无主的杂乱由${ctx.self}认领，未进入分工表`
        };
      }
    },
    /* 12. 处理 / 解决 / 应对 —— 统筹类 */
    {
      re: /(处理|解决|应对|搞定|盯)(.{0,16})/,
      build(m, ctx) {
        return {
          name: `${m[1]}${trimLen(m[2], 16)}`,
          cats: ['统筹类'],
          minutes: 25,
          reason: `突发事件默认路由到${ctx.self}`
        };
      }
    },
    /* 13. 解释 / 道歉 / 交涉 —— 情绪类 */
    {
      re: /(解释|道歉|交涉|跟.{1,6}(?:说|解释|沟通))(.{0,14})/,
      build(m) {
        return {
          name: `${m[1]}${trimLen(m[2], 14)}`,
          cats: ['情绪类'],
          minutes: 20,
          reason: `对外关系的修复由一人承担，无分工约定`
        };
      }
    },
    /* 14. 送 / 拿 / 取 跑一趟（含方向补语） —— 补救类 */
    {
      re: /(送|拿|取|跑|带)(?:过去|到|去|一趟|回)(.{2,16})/,
      build(m, ctx) {
        const obj = trimLen(m[2], 16);
        return {
          name: `${m[1]}${obj}`,
          cats: ['补救类'],
          minutes: 35,
          reason: `他人遗漏在前，${ctx.self}事后跑动补位`
        };
      }
    },
    /* 15. 陪 / 带 —— 情绪类 */
    {
      re: /(陪|带)(孩子|娃|他|她)?(.{0,12})/,
      build(m) {
        const obj = (m[2] || '孩子') + clean(m[3]);
        return {
          name: `陪${obj}`,
          cats: ['情绪类', '统筹类'],
          minutes: 30,
          reason: `陪伴时间被视为“本分”，未计入劳动`
        };
      }
    },
    /* 16. 接 / 送孩子 —— 统筹类 */
    {
      re: /(接|送)(孩子|娃|他|她)(.{0,10})/,
      build(m) {
        return {
          name: `${m[1]}${m[2]}${trimLen(m[3], 10)}`,
          cats: ['统筹类'],
          minutes: 30,
          reason: `接送节点由一人记挂，临时调整也由一人处理`
        };
      }
    }
  ];

  /* ---------- 兜底：包含家庭名词的句子 ---------- */
  const HOME_NOUN = /(娃|孩子|儿子|女儿|老公|他爸|婆婆|老师|学校|幼儿园|作业|纸巾|洗手液|水电|燃气|缴费|医院|疫苗|快递|衣服|饭|菜|房间|客厅|床单|礼物|生日|红包|票|空调|宠物|猫|狗)/;

  /* ---------- 心理负荷指数 ---------- */
  function stars(cats, hit) {
    if (hit && hit.star) return hit.star;
    let s = 3;
    if (cats.indexOf('情绪类') !== -1) s = 4;
    if (cats.indexOf('统筹类') !== -1) s = 4;
    if (cats.indexOf('记忆类') !== -1) s = 3;
    if (cats.indexOf('补救类') !== -1) s = 3;
    if (cats.length >= 2) s = Math.min(5, s + 1);
    return s;
  }

  /* ---------- 主入口 ---------- */
  function parse(text, opts) {
    opts = opts || {};
    const self = opts.self || '妈妈';
    const partner = opts.partner || '爸爸';
    const wage = typeof opts.wage === 'number' ? opts.wage : 40;
    const child = opts.child || '孩子';
    const date = opts.date || new Date().toISOString();

    const ctx = { self, partner, child, wage };
    const clauses = splitClauses(text);
    const tasks = [];
    const dropped = [];

    clauses.forEach(clause => {
      // 纯情绪发泄：不产生任务
      if (EMOTION_ONLY.test(clause) && !TASK_VERB.test(clause.replace(EMOTION_ONLY, ''))) {
        dropped.push({ clause, why: '纯情绪表达，无可提取任务' });
        return;
      }

      let hitRule = null, matched = null;
      for (const r of RULES) {
        const m = clause.match(r.re);
        if (m) { hitRule = r; matched = m; break; }
      }

      let built;
      if (hitRule) {
        built = hitRule.build(matched, ctx);
      } else if (HOME_NOUN.test(clause)) {
        built = {
          name: trimLen(clause, 20),
          cats: ['统筹类'],
          minutes: 20,
          reason: `未进入任何人的待办清单，由${self}单点承接`
        };
      } else {
        dropped.push({ clause, why: '未匹配到家庭事务语义' });
        return;
      }

      const dictHit = matchDict(clause + built.name);
      const dur = parseDuration(clause) || built.minutes || (dictHit ? dictHit.min : 0) || 20;
      const catKeys = built.cats.map(c => LABEL_KEY[c]);
      const partnerMentioned = PARTNER.test(clause);

      tasks.push({
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date,
        raw: clause,
        name: built.name.replace(/\s+/g, ''),
        cats: built.cats,
        catKeys,
        owner: self,
        judged: '是（' + built.reason + '）',
        invisible: true,
        minutes: dur,
        value: Math.round((dur / 60) * wage * 10) / 10,
        partnerMinutes: 0,
        partnerMentioned,
        star: stars(built.cats, dictHit),
        dictId: dictHit ? dictHit.id : null,
        status: 'done'
      });
    });

    return { tasks, dropped, meta: { wage, self, partner, clauseCount: clauses.length } };
  }

  /* ---------- 输出为规定格式的 JSON ---------- */
  function toSpecJson(t) {
    return {
      '任务名称': t.name,
      '任务类型': t.cats.join('+'),
      '承担者': t.owner,
      '隐形劳动判定': t.judged,
      '预计耗时（分钟）': t.minutes,
      '折合家政时薪价值（元）': t.value
    };
  }

  return { parse, toSpecJson, splitClauses, matchDict, CAT_LABEL };
})();

if (typeof window !== 'undefined') window.Parser = Parser;
