# Cal Dining 双语菜单

UC Berkeley 食堂菜单的中英对照 + 每道菜的说明。纯静态，托管在 GitHub Pages，
手机加到主屏幕当 app 用，断网也能打开。

---

## 每周操作流程

周日在 Mac 上：

```bash
python3 scrape.py
```

1. **看终端有没有 ⚠️ 报警。有就先修，别继续。**
2. 打开 `data/missing.json`。`dishes` 是空的就跳到第 4 步。
3. 把 `missing.json` 的内容丢给 Claude，要求「按 glossary 格式填 zh 和 note，
   note 里写清主料、做法、辣不辣、油不油」，把结果粘进 `data/glossary.json`
   对应的 `dishes` / `stations` 里。
4. 把 `data/menu.json` 和 `data/glossary.json` 拖到 GitHub 网页上传。
5. 手机上刷新一次页面。

第一周的术语表已经填满（558 道菜 + 38 个档口），之后每周只需要补新出现的菜，
预计 3–5 分钟。

---

## 文件说明

```
scrape.py            手动运行，抓菜单
data/menu.json       脚本生成，勿手改
data/glossary.json   唯一需要人工编辑的文件
data/missing.json    脚本生成，待翻译清单
index.html / app.js / style.css
sw.js                service worker，离线缓存
manifest.json        PWA 配置
make_icons.py        生成 icons/ 里的图标，只有想换样子时才需要重跑
icons/               PWA 图标
```

依赖：`requests`、`beautifulsoup4`。

```bash
python3 -m pip install --user requests beautifulsoup4
```

---

## 关于数据源的两件事

**1. 菜单页一次只给一天，不是一整周。**

`https://dining.berkeley.edu/menus/` 直接 GET 只返回**当天**的菜单。页面上的
日期下拉框是靠 ajax 换数据的：

```
POST https://dining.berkeley.edu/wp-admin/admin-ajax.php
action=cald_filter_xml & location= & mealperiod= & date=YYYYMMDD
```

所以 `scrape.py` 是按天打这个接口，一次 7 天。仍然不需要浏览器驱动，
`requests` 就够。

**2. Café 3 暑假整周都不出现。**

它还留在 `WANTED_LOCATIONS` 里，秋季开学恢复供餐后会自动出现，不用改代码。
终端会打印一行「Café 3 本周没有菜单」提示这件事。

---

## 营业时间

每个餐段带一个 `hours` 字段，24 小时制：

```json
{ "name": "Dinner", "hours": { "start": "16:30", "end": "21:00" }, "stations": [ ... ] }
```

站点上营业时间和餐段是按顺序一一对应的（已核对过全部食堂 × 多天）。
数量对不上时脚本会报警并把这天的 `hours` 置空，宁可不显示也不张冠李戴。

**不存站点上那个 `Now Open` / `Now Closed`** —— 那是抓取当刻的状态，
存进 JSON 立刻就过期了。前端拿 `hours` 和手机当前时间实时算，
每 30 秒刷新一次徽章。

## 脚本的几个保护

- **零结果就报错退出**，绝不会拿空数据覆盖掉好的 `menu.json`
  （站点改版时解析逻辑失效，必须让你知道）
- **日期校验**用页面自己声明的日期（`.serve-date`）跟请求日期比对，
  对不上就报警 —— 多半是抓到了 CDN 缓存
- **图标去重**，站点上过敏原图标会重复出现
- **菜名归一化**：去首尾空格、合并连续空格、弯引号转直引号。
  不转小写、不去标点 —— 前端要拿原文跟档口牌子对照

归一化后的菜名同时是 `glossary.json` 的 key 和前端的显示文本。站点上的错别字
（`Assorted MIni Cheesecakes` 中间那个大写 I）原样保留当 key，不要「顺手修正」，
改了就匹配不上了。

---

## 本地预览

```bash
python3 -m http.server 8791 --directory .
```

然后开 `http://localhost:8791`。

注意：service worker 对静态文件用的是「缓存优先 + 后台更新」，所以改了
`app.js` / `style.css` 之后要**刷新两次**才看到新版本（第一次刷新在后台
更新缓存，第二次才用上）。两个 JSON 是网络优先，每周更新后刷新一次就生效。

---

## 部署

GitHub Pages，仓库根目录直接发布即可。所有路径都是相对的（`./`），
放在 `username.github.io/仓库名/` 这种子路径下也能正常工作。
