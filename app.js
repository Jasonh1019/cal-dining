'use strict';

/* 图标中文对照。站点上是固定集合，硬编码在这里，不进术语表。 */
const ALLERGEN_ZH = {
  'milk': '奶', 'egg': '蛋', 'fish': '鱼', 'shellfish': '贝类',
  'tree-nuts': '坚果', 'wheat': '小麦', 'peanuts': '花生',
  'soybeans': '大豆', 'sesame': '芝麻', 'gluten': '麸质',
  'pork': '猪肉', 'alcohol': '酒'
};
const DIET_ZH = {
  'vegan': '纯素', 'vegetarian': '素', 'halal': '清真', 'kosher': '洁食'
};
const CARBON_ZH = { 'low': '低碳', 'medium': '中碳', 'high': '高碳' };

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MEAL_ZH = {
  'Breakfast': '早餐', 'Brunch': '早午餐', 'Lunch': '午餐',
  'Dinner': '晚餐', 'All Day': '全天'
};
const MEAL_ORDER = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'All Day'];

const state = { menu: null, glossary: null, date: null, location: null };

const $ = (sel) => document.querySelector(sel);

/* ---------- 载入 ---------- */

async function load() {
  try {
    const [menu, glossary] = await Promise.all([
      fetch('./data/menu.json').then(r => r.json()),
      fetch('./data/glossary.json').then(r => r.json()).catch(() => ({ dishes: {}, stations: {} }))
    ]);
    state.menu = menu;
    state.glossary = glossary;
    init();
  } catch (e) {
    $('#menu').innerHTML =
      '<p class="empty">菜单载入失败。<br>联网后刷新一次，之后就能离线看了。</p>';
  }
}

function init() {
  const days = state.menu.days || [];
  if (!days.length) {
    $('#menu').innerHTML = '<p class="empty">没有菜单数据，去 Mac 上重跑一次 scrape.py。</p>';
    return;
  }

  // 默认今天；今天不在数据里（比如周末抓的下周）就用第一天
  const today = localDateString(new Date());
  state.date = days.some(d => d.date === today) ? today : days[0].date;

  // 食堂默认 Crossroads，但记住上次选的
  const saved = localStorage.getItem('cal-dining-location');
  const available = allLocations();
  state.location = available.includes(saved) ? saved
                 : (available.includes('Crossroads') ? 'Crossroads' : available[0]);

  renderStamp();
  render();
}

/* ---------- 工具 ---------- */

// 用本地时区算日期，别用 toISOString（那个是 UTC，晚上会串到明天）
function localDateString(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function allLocations() {
  const seen = [];
  for (const day of state.menu.days) {
    for (const loc of day.locations) {
      if (!seen.includes(loc.name)) seen.push(loc.name);
    }
  }
  return seen;
}

function currentDay() {
  return state.menu.days.find(d => d.date === state.date);
}

/* ---------- 营业时间 ---------- */

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// '07:00' -> '7:00'，省点横向空间
const fmtTime = (hhmm) => hhmm.replace(/^0/, '');

/**
 * 这一餐现在什么状态。只在看「今天」时有意义 —— 看周四的菜单还说
 * 「供餐中」就是胡说了。
 * 返回 {kind: 'serving'|'upcoming'|'ended', mins} ，mins 是距离开始/结束的分钟。
 */
function mealStatus(hours) {
  if (!hours) return null;
  let s = toMin(hours.start);
  let e = toMin(hours.end);
  if (e <= s) e += 1440;               // 跨夜，比如 12:00–00:00

  let n = nowMin();
  if (n < s && n + 1440 < e) n += 1440; // 凌晨看昨晚还没结束的那一餐

  if (n < s) return { kind: 'upcoming', mins: s - n };
  if (n < e) return { kind: 'serving', mins: e - n };
  return { kind: 'ended', mins: n - e };
}

// 该默认展开哪一餐：正在供餐的 > 下一顿 > 最后一顿
function pickMeal(meals, isToday) {
  if (isToday) {
    const withHours = meals.filter(m => m.hours);
    if (withHours.length) {
      const serving = withHours.find(m => mealStatus(m.hours).kind === 'serving');
      if (serving) return meals.indexOf(serving);

      const upcoming = withHours
        .filter(m => mealStatus(m.hours).kind === 'upcoming')
        .sort((a, b) => mealStatus(a.hours).mins - mealStatus(b.hours).mins)[0];
      if (upcoming) return meals.indexOf(upcoming);

      return meals.length - 1;          // 今天全部结束了，停在最后一顿
    }
  }
  // 没有营业时间，或者看的不是今天：按当前钟点粗略猜
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  const want = h < 10.5 ? 'Breakfast' : (h < 16 ? 'Lunch' : 'Dinner');
  const i = meals.findIndex(m => m.name === want);
  return i === -1 ? 0 : i;
}

/* ---------- 渲染 ---------- */

function renderStamp() {
  const at = state.menu.scraped_at;
  if (!at) return;
  const d = new Date(at);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const stale = days >= 7;
  $('#stamp').innerHTML =
    `数据抓取于 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` +
    (stale ? ' <b class="stale">· 已超过一周，该更新了</b>' : '');
}

/**
 * 数据过没过期的横幅。放在顶部切换器下面，一进来就撞见 ——
 * 之前只在页脚写一行，得滑过几百道菜才看得到，等于没提示。
 */
function renderFreshness() {
  const el = $('#freshness');
  const dates = state.menu.days.map(d => d.date);
  const today = localDateString(new Date());
  const md = (s) => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };

  if (!dates.includes(today)) {
    // 最严重的情况：显示的根本不是今天的菜
    el.className = 'fresh stale';
    el.innerHTML =
      `⚠️ 菜单已过期：这是 ${md(dates[0])}–${md(dates[dates.length - 1])} 那周的，没有今天的数据` +
      `<small>去 Mac 上双击「每周更新」，再把 menu.json 传一次</small>`;
  } else if (dates[dates.length - 1] === today) {
    // 还能用，但明天就没了
    el.className = 'fresh warn';
    el.innerHTML = '今天是这批菜单的最后一天，该更新了';
  } else {
    el.className = 'fresh';
    el.innerHTML = '';
  }
}

function renderSwitchers() {
  const dates = state.menu.days.map(day => {
    const d = parseDate(day.date);
    const isToday = day.date === localDateString(new Date());
    const label = `${WEEKDAY[d.getDay()]}<small>${d.getMonth() + 1}/${d.getDate()}</small>`;
    return chip(label, day.date === state.date, { date: day.date }, isToday ? 'today' : '');
  }).join('');
  $('#dates').innerHTML = dates;

  const day = currentDay();
  const open = day ? day.locations.map(l => l.name) : [];
  const locs = allLocations().map(name => {
    const closed = !open.includes(name);
    return chip(name, name === state.location, { loc: name }, closed ? 'closed' : '');
  }).join('');
  $('#locations').innerHTML = locs;
}

function chip(label, active, data, extra) {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${escapeAttr(v)}"`).join(' ');
  return `<button role="tab" aria-selected="${active}" class="chip ${active ? 'on' : ''} ${extra || ''}" ${attrs}>${label}</button>`;
}

function render() {
  renderSwitchers();
  renderFreshness();
  measureHeader();

  const day = currentDay();
  const loc = day && day.locations.find(l => l.name === state.location);

  if (!loc) {
    $('#menu').innerHTML =
      `<p class="empty">${escapeHtml(state.location)} 这天没有菜单<br><small>可能是假期或周末关门，换个食堂或换一天看看</small></p>`;
    return;
  }

  const rank = (m) => {
    const i = MEAL_ORDER.indexOf(m.name);
    return i === -1 ? MEAL_ORDER.length : i;  // 没见过的餐段排最后
  };
  const meals = [...loc.meals].sort((a, b) => rank(a) - rank(b));
  const isToday = state.date === localDateString(new Date());
  const openIdx = pickMeal(meals, isToday);

  $('#menu').innerHTML = meals.map((meal, i) => `
    <section class="meal">
      <details ${i === openIdx ? 'open' : ''}>
        <summary>
          <span class="meal-zh">${MEAL_ZH[meal.name] || ''}</span>
          <span class="meal-en">${escapeHtml(meal.name)}</span>
          <span class="count">${countItems(meal)} 道</span>
          ${meal.hours
            ? `<span class="hours">${fmtTime(meal.hours.start)}–${fmtTime(meal.hours.end)}</span>
               <span class="mstatus" data-start="${meal.hours.start}" data-end="${meal.hours.end}"></span>`
            : '<span class="hours no-hours">时间未知</span>'}
        </summary>
        ${meal.stations.map(renderStation).join('')}
      </details>
    </section>
  `).join('');

  $('#menu').dataset.today = isToday ? '1' : '';
  refreshStatuses();
}

/**
 * 刷新「供餐中 / 还有几分钟」这些徽章。
 * 单独拿出来每分钟跑一次 —— 直接重渲染会把用户手动展开的餐段收回去。
 */
function refreshStatuses() {
  const menu = $('#menu');
  if (!menu) return;
  const isToday = menu.dataset.today === '1';

  menu.querySelectorAll('.mstatus').forEach(el => {
    if (!isToday) { el.textContent = ''; el.className = 'mstatus'; return; }

    const st = mealStatus({ start: el.dataset.start, end: el.dataset.end });
    if (!st) { el.textContent = ''; el.className = 'mstatus'; return; }

    let text, cls;
    if (st.kind === 'serving') {
      // 快关门了是走路时最该知道的事
      if (st.mins <= 30) { text = `还有 ${st.mins} 分钟结束`; cls = 'soon'; }
      else { text = '供餐中'; cls = 'serving'; }
    } else if (st.kind === 'upcoming') {
      if (st.mins <= 60) { text = `${st.mins} 分钟后开饭`; cls = 'soon'; }
      else { text = '未开始'; cls = 'off'; }
    } else {
      text = '已结束';
      cls = 'off';
    }
    el.textContent = text;
    el.className = `mstatus ${cls}`;
  });
}

// 顶部切换器高度随字号/机型变，实测后交给 CSS 定位餐段标题
function measureHeader() {
  const h = document.querySelector('.top').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--head-h', Math.round(h) + 'px');
}

function countItems(meal) {
  return meal.stations.reduce((n, s) => n + s.items.length, 0);
}

function renderStation(station) {
  const zh = state.glossary.stations[station.name];
  return `
    <div class="station">
      <h3>
        <span class="st-en">${escapeHtml(station.name)}</span>
        ${zh ? `<span class="st-zh">${escapeHtml(zh)}</span>` : '<span class="st-todo">待译</span>'}
      </h3>
      <ul class="dishes">${station.items.map(renderItem).join('')}</ul>
    </div>`;
}

function renderItem(item) {
  const g = state.glossary.dishes[item.name];
  const translated = g && g.zh;

  const diet = (item.diet || []).map(
    d => `<span class="tag diet ${d}">${DIET_ZH[d] || d}</span>`).join('');
  const allergens = (item.allergens || []).map(
    a => `<span class="tag alg">${ALLERGEN_ZH[a] || a}</span>`).join('');
  const carbon = item.carbon
    ? `<span class="tag carbon ${item.carbon}">${CARBON_ZH[item.carbon]}</span>` : '';

  return `
    <li class="dish ${translated ? '' : 'untranslated'}">
      <div class="en">${escapeHtml(item.name)}${translated ? '' : '<span class="todo">待译</span>'}</div>
      ${translated ? `<div class="zh">${escapeHtml(g.zh)}</div>` : ''}
      ${translated && g.note ? `<div class="note">${escapeHtml(g.note)}</div>` : ''}
      <div class="tags">${diet}${allergens}${carbon}</div>
    </li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* ---------- 交互 ---------- */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  if (btn.dataset.date) {
    state.date = btn.dataset.date;
  } else if (btn.dataset.loc) {
    state.location = btn.dataset.loc;
    localStorage.setItem('cal-dining-location', state.location);
  } else {
    return;
  }
  render();
  window.scrollTo({ top: 0 });
});

window.addEventListener('resize', measureHeader);
window.addEventListener('orientationchange', measureHeader);

// 徽章每分钟自己更新，页面开着也不会显示过期的「供餐中」
setInterval(refreshStatuses, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshStatuses();
});

load();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
