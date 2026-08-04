#!/usr/bin/env python3
"""
Cal Dining 菜单抓取脚本。

每周日手动跑一次：
    python3 scrape.py

产出：
    data/menu.json     — 菜单数据，勿手改
    data/missing.json  — 待翻译清单，填完粘回 glossary.json

注意：dining.berkeley.edu 的菜单页一次只渲染当天。整周数据要
按天打 admin-ajax 接口（见 fetch_day）。这不需要浏览器驱动，
requests 就够。
"""

import json
import re
import sys
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

MENUS_URL = "https://dining.berkeley.edu/menus/"
AJAX_URL = "https://dining.berkeley.edu/wp-admin/admin-ajax.php"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

DAYS_AHEAD = 7  # 今天 + 之后 6 天

# 只要这四个 dining commons。其余是便利店/咖啡厅，菜单是货架描述，没用。
# Café 3 暑假关门，站点上整周都不出现 —— 留在这里，等它开了自动就有了。
WANTED_LOCATIONS = ["Café 3", "Clark Kerr", "Crossroads", "Foothill"]

# 图标词表。站点上是固定集合，直接硬编码，不进术语表。
ALLERGEN_ICONS = {
    "Milk": "milk",
    "Egg": "egg",
    "Fish": "fish",
    "Shellfish": "shellfish",
    "Tree Nuts": "tree-nuts",
    "Wheat": "wheat",
    "Peanuts": "peanuts",
    "Soybeans": "soybeans",
    "Sesame": "sesame",
    "Gluten": "gluten",
    "Pork": "pork",
    "Alcohol": "alcohol",
}
DIET_ICONS = {
    "Vegan Option": "vegan",
    "Vegetarian Option": "vegetarian",
    "Halal": "halal",
    "Kosher": "kosher",
}
CARBON_ICONS = {
    "Low Carbon Footprint": "low",
    "Medium Carbon Footprint": "medium",
    "High Carbon Footprint": "high",
}

SEASON_PREFIX = re.compile(r"^(Spring|Summer|Fall|Autumn|Winter)\s*-\s*")

warnings: list[str] = []


def warn(msg: str) -> None:
    warnings.append(msg)


def normalize(s: str) -> str:
    """
    归一化菜名/档口名。归一化后的字符串同时作为 glossary 的 key
    和前端的显示文本，所以只清空白和引号，不动大小写和标点。
    """
    if not s:
        return ""
    s = unicodedata.normalize("NFC", s)
    s = s.replace("‘", "'").replace("’", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = re.sub(r"\s+", " ", s)  # 合并连续空格，顺带干掉 &nbsp;
    return s.strip()


def strip_season(meal_name: str) -> str:
    """'Summer - Dinner' -> 'Dinner'"""
    return SEASON_PREFIX.sub("", meal_name).strip()


def first_span_text(node) -> str:
    """取直接子节点里的第一个 <span> 的文本 —— 就是名字本身，不含图标。"""
    span = node.find("span", recursive=False)
    return normalize(span.get_text(" ", strip=True)) if span else ""


def fetch_day(session: requests.Session, yyyymmdd: str) -> str:
    """
    拿某一天的菜单 HTML 片段。

    这是页面上日期下拉框背后的接口（见 cal-dining/assets/custom.js）。
    location / mealperiod 留空 = 全部。
    """
    resp = session.post(
        AJAX_URL,
        data={
            "action": "cald_filter_xml",
            "location": "",
            "mealperiod": "",
            "date": yyyymmdd,
        },
        headers={"User-Agent": UA, "X-Requested-With": "XMLHttpRequest"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.text


def parse_icons(li) -> tuple[list[str], list[str], str | None]:
    """把一道菜的图标分成 过敏原 / 膳食 / 碳足迹。图标会重复，这里去重。"""
    allergens: list[str] = []
    diet: list[str] = []
    carbon: str | None = None

    for tip in li.select(".food-icon .allg-tooltip"):
        label = normalize(tip.get_text(" ", strip=True))
        if not label:
            continue
        if label in ALLERGEN_ICONS:
            slug = ALLERGEN_ICONS[label]
            if slug not in allergens:
                allergens.append(slug)
        elif label in DIET_ICONS:
            slug = DIET_ICONS[label]
            if slug not in diet:
                diet.append(slug)
        elif label in CARBON_ICONS:
            carbon = CARBON_ICONS[label]
        else:
            # 站点加了新图标 —— 报出来，别静默丢掉
            warn(f"未知图标：{label!r}（站点可能加了新标记，去 scrape.py 补词表）")

    return allergens, diet, carbon


def parse_serve_date(text: str, expected: date) -> date | None:
    """
    '.serve-date' 长这样：'Mon, Aug 3' —— 没有年份。
    用期望日期的年份去补，然后校验月/日对不对得上。
    """
    text = normalize(text)
    m = re.search(r"([A-Za-z]{3,9})\s+(\d{1,2})", text)
    if not m:
        return None
    month_name, day = m.group(1), int(m.group(2))
    for fmt in ("%b", "%B"):
        try:
            month = datetime.strptime(month_name[:3] if fmt == "%b" else month_name, fmt).month
            break
        except ValueError:
            continue
    else:
        return None

    # 跨年时（12 月抓 1 月的菜单）年份要 +1
    for year in (expected.year, expected.year + 1, expected.year - 1):
        try:
            cand = date(year, month, day)
        except ValueError:
            continue
        if abs((cand - expected).days) <= 3:
            return cand
    try:
        return date(expected.year, month, day)
    except ValueError:
        return None


TIME_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?", re.I)


def parse_hours(text: str) -> dict | None:
    """
    '7:00 a.m. - 10:00 a.m.' -> {'start': '07:00', 'end': '10:00'}

    存 24 小时制，前端好比大小；「现在开没开」交给前端实时算，
    不存站点上那个 'Now Open' —— 那是抓取当刻的状态，存下来立刻就过期了。
    """
    if not text:
        return None
    found = TIME_RE.findall(text)
    if len(found) < 2:
        return None

    def to24(h, m, ampm):
        h, m = int(h), int(m or 0)   # 站点偶尔写成 '8 a.m.'，没有分钟
        ampm = ampm.lower()
        if ampm == "a" and h == 12:      # 12:xx a.m. = 半夜
            h = 0
        elif ampm == "p" and h != 12:    # 12:xx p.m. = 正午，不用加
            h += 12
        if not (0 <= h <= 23 and 0 <= m <= 59):
            return None
        return f"{h:02d}:{m:02d}"

    start, end = to24(*found[0]), to24(*found[1])
    if not start or not end:
        return None
    return {"start": start, "end": end}


def parse_location(loc_node, target_name: str) -> dict | None:
    """解析一个食堂：餐段 -> 档口 -> 菜品"""
    periods = loc_node.select("li.preiod-name")

    # 营业时间和餐段是按顺序一一对应的（已核对过多个食堂/多天）。
    # 数量对不上就宁可不显示时间，也不能张冠李戴。
    time_texts = [normalize(s.get_text(" ", strip=True))
                  for s in loc_node.select(".cafe-status .times span")]
    if len(time_texts) != len(periods):
        warn(
            f"{target_name}：营业时间 {len(time_texts)} 段、餐段 {len(periods)} 段，"
            "对不上，这天不显示时间"
        )
        time_texts = [""] * len(periods)

    meals = []
    for idx, period in enumerate(periods):
        meal_name = strip_season(first_span_text(period))
        if not meal_name:
            continue

        stations = []
        for cat in period.select(".cat-name"):
            station_name = first_span_text(cat)
            items = []
            for li in cat.select("li.recip"):
                dish = first_span_text(li)
                if not dish:
                    continue
                allergens, diet, carbon = parse_icons(li)
                items.append(
                    {
                        "name": dish,
                        "diet": diet,
                        "allergens": allergens,
                        "carbon": carbon,
                    }
                )
            if items:
                stations.append({"name": station_name, "items": items})

        if stations:
            meals.append({
                "name": meal_name,
                "hours": parse_hours(time_texts[idx]),
                "stations": stations,
            })

    if not meals:
        return None
    return {"name": target_name, "meals": meals}


def match_location(loc_node, wanted: str) -> bool:
    """
    站点用 .cafe-title 显示名字，但暑期/改版时可能带后缀。
    比对时两边都归一化 + 去掉重音，宽松一点。
    """
    title = normalize(loc_node.select_one(".cafe-title").get_text(" ", strip=True)) if loc_node.select_one(".cafe-title") else ""

    def key(s: str) -> str:
        s = unicodedata.normalize("NFKD", s)
        s = "".join(c for c in s if not unicodedata.combining(c))
        return re.sub(r"[^a-z0-9]", "", s.lower())

    return key(title) == key(wanted)


def scrape() -> dict:
    session = requests.Session()
    # 先摸一下主页，拿 cookie，顺便确认站点还活着
    try:
        session.get(MENUS_URL, headers={"User-Agent": UA}, timeout=60).raise_for_status()
    except requests.RequestException as e:
        sys.exit(f"错误：打不开 {MENUS_URL} —— {e}")

    today = date.today()
    days = []
    seen_locations: set[str] = set()

    for offset in range(DAYS_AHEAD):
        day = today + timedelta(days=offset)
        stamp = day.strftime("%Y%m%d")
        print(f"  抓取 {day.isoformat()} ...", end="", flush=True)

        try:
            html = fetch_day(session, stamp)
        except requests.RequestException as e:
            warn(f"{day.isoformat()} 抓取失败：{e}")
            print(" 失败")
            continue

        soup = BeautifulSoup(html, "html.parser")
        loc_nodes = soup.select(".location-name")

        # 日期校验：用页面自己写的日期，不是脚本推算的
        declared: date | None = None
        for node in loc_nodes:
            sd = node.select_one(".serve-date")
            if sd:
                declared = parse_serve_date(sd.get_text(" ", strip=True), day)
                break
        if declared and declared != day:
            warn(
                f"日期对不上：请求 {day.isoformat()}，页面却说是 {declared.isoformat()}"
                "（可能是 CDN 缓存，隔几分钟重跑）"
            )

        locations = []
        for wanted in WANTED_LOCATIONS:
            node = next((n for n in loc_nodes if match_location(n, wanted)), None)
            if node is None:
                continue
            parsed = parse_location(node, wanted)
            if parsed:
                locations.append(parsed)
                seen_locations.add(wanted)

        n_items = sum(
            len(st["items"])
            for loc in locations
            for meal in loc["meals"]
            for st in meal["stations"]
        )
        print(f" {len(locations)} 个食堂，{n_items} 道菜")

        days.append(
            {
                "date": (declared or day).isoformat(),
                "locations": locations,
            }
        )

    for wanted in WANTED_LOCATIONS:
        if wanted not in seen_locations:
            print(f"  （{wanted} 本周没有菜单，可能是假期关门）")

    return {
        "scraped_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_dates": [d["date"] for d in days],
        "days": days,
    }


def collect_names(menu: dict) -> tuple[list[str], list[str]]:
    dishes, stations = {}, {}
    for day in menu["days"]:
        for loc in day["locations"]:
            for meal in loc["meals"]:
                for st in meal["stations"]:
                    stations.setdefault(st["name"], None)
                    for item in st["items"]:
                        dishes.setdefault(item["name"], None)
    return list(dishes), list(stations)


def main() -> None:
    print("抓取 Cal Dining 菜单…")
    menu = scrape()

    total = sum(
        len(st["items"])
        for day in menu["days"]
        for loc in day["locations"]
        for meal in loc["meals"]
        for st in meal["stations"]
    )

    # 零结果 = 站点改版，解析逻辑失效。必须停，绝不能拿空数据盖掉好数据。
    if total == 0:
        print()
        for w in warnings:
            print(f"  ⚠️  {w}")
        sys.exit(
            "\n错误：一道菜都没解析出来。\n"
            "多半是 Cal Dining 改版了，scrape.py 的选择器要更新。\n"
            "已保留原有的 menu.json 没动。"
        )

    # 日期校验：第一天早于今天说明抓到了旧缓存
    if menu["source_dates"]:
        first = date.fromisoformat(menu["source_dates"][0])
        if first < date.today():
            warn(
                f"页面声明的首日是 {first.isoformat()}，早于今天 "
                f"{date.today().isoformat()} —— 数据可能是旧缓存"
            )

    DATA.mkdir(exist_ok=True)

    # 术语表对不上的挑出来
    glossary_path = DATA / "glossary.json"
    if glossary_path.exists():
        glossary = json.loads(glossary_path.read_text(encoding="utf-8"))
    else:
        glossary = {"dishes": {}, "stations": {}}
        print("  （还没有 glossary.json，这次所有菜都算待翻译）")

    known_dishes = glossary.get("dishes", {})
    known_stations = glossary.get("stations", {})

    dishes, stations = collect_names(menu)
    missing_dishes = {
        d: {"zh": "", "note": ""}
        for d in dishes
        if not known_dishes.get(d, {}).get("zh")
    }
    missing_stations = {s: "" for s in stations if not known_stations.get(s)}

    # 写文件。先写到临时文件再改名，中途挂了也不会留个半截的 JSON。
    for path, payload in (
        (DATA / "menu.json", menu),
        (DATA / "missing.json", {"dishes": missing_dishes, "stations": missing_stations}),
    ):
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        tmp.replace(path)

    print()
    print(f"✅ 共 {total} 道菜，{len(menu['days'])} 天，写入 data/menu.json")
    print(f"   菜名 {len(dishes)} 个，档口 {len(stations)} 个")

    if warnings:
        print()
        for w in warnings:
            print(f"  ⚠️  {w}")

    print()
    if missing_dishes or missing_stations:
        print(
            f"本次新增 {len(missing_dishes)} 道菜、{len(missing_stations)} 个档口待翻译"
            " → data/missing.json"
        )
    else:
        print("没有待翻译的条目，术语表是全的 🎉")


if __name__ == "__main__":
    main()
