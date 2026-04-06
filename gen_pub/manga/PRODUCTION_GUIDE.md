# 神临山海·卷一·千里江山 — AI漫剧制作指南

> **本文件供 CaptainCast AI智能体读取，用于自动化生产AI漫剧内容。**

---

## 一、项目概述

将《神临山海》第一部「灵机江湖」卷一「千里江山」的25章小说正文，转化为AI生成的漫剧（静态漫画+配音+字幕的短视频形式）。

- **IP名称**: 神临山海 / Godrise
- **卷一名称**: 千里江山（25章，约8万字）
- **美学定调**: 千里江山图 + 中式赛博朋克（敦煌壁画色彩 × 霓虹数据流）
- **核心关键词**: 七彩、水墨质感、矿物颜料、灵机粒子、东方神话硬科幻

---

## 二、源素材索引

所有路径相对于项目根目录 `/Users/wyon/root/code-ai/godrise/`

### 正文（最核心素材）

| 格式 | 路径 | 说明 |
|------|------|------|
| Markdown | `02_Drafts/Book1_灵机江湖/Chapter_001_入画.md` ~ `Chapter_025_千里.md` | 完整正文，含格式标注 |
| 纯文本 | `06_Publishing/txt_chapters/Chapter_001_入画.txt` ~ `Chapter_025_千里.txt` | 干净纯文本，适合NLP处理 |
| 25章梗概 | `02_Drafts/Book1_灵机江湖/卷一_千里江山_25章梗概.md` | 每章一段话总结 |

### 视觉设计（生图必读）

| 文件 | 路径 | 内容 |
|------|------|------|
| **25章逐章视觉美学** | `04_Outlines/book1_visual_design.md` (76KB) | 每章：现实原型、奇幻增强、主色调Hex值、光影特征、核心视觉奇观描述、灵机视觉化方案 |

**这是最重要的生图参考文件**——每章都有一段"核心视觉奇观"描述，可直接改写为生图prompt。

### 角色设计

| 文件 | 路径 | 内容 |
|------|------|------|
| 角色圣经v2.0 | `01_Characters/book1_character_bible.md` (33KB) | 7个核心角色：外貌、标志、身体语言、核心矛盾 |

### 世界观 & 风格

| 文件 | 路径 | 内容 |
|------|------|------|
| 文明简史 | `00_World_Bible/civilization_timeline.md` | 万年时间线、灵机理论、收割者设定 |
| 风格定调 | `05_Reference/style_samples.md` | 文笔风格+10条风格戒律 |
| 构架总览 | `04_Outlines/book1_ultimate_architecture.md` | 四卷100章结构、25个名场面 |

---

## 三、视觉风格规范

### 3.1 底层美学

**千里江山图 + 中式赛博朋克**

- 底色：王希孟青绿山水的矿物颜料质感（石青、石绿、赭石、朱砂）
- 叠加：赛博朋克发光数据网格、灵力粒子流、穹顶结构光
- 融合方式：数据流像水墨晕染一样自然渗入山水，不是硬混搭

### 3.2 参考作品坐标系

| 作品 | 提取元素 | 应用场景 |
|------|---------|---------|
| 雾山五行 | 水墨动态战斗、色彩爆发力 | 每章高潮画面 |
| 界外狂潮 | 几何体美学、冷峻宇宙感 | 收割者降临(Ch22-24) |
| 蜘蛛侠·纵横宇宙 | 多风格碰撞 | 场景切换时的视觉冲击 |
| 遗忘之海 | 浸没式水下美学 | 九色渊水下(Ch1) |
| 敦煌壁画 | 矿物颜料色彩、飞天动态 | 千佛崖(Ch10-11) |

### 3.3 色彩节奏总览

```
Ch1-3   九色渊区：液态七彩（水光流转）
Ch4-5   万剑墟：冷银+暗金（金属锐感）
Ch6     云海：乳白+极光彩（漂浮柔软）
Ch7-8   悬松岭：纯水墨（黑白灰+飞白）
Ch9     曲率崖：单色压迫（灰蓝冷调）
Ch10-11 千佛崖：敦煌矿彩（赤金赭蓝）
Ch12    赤霞壁：情绪七彩（大地热烈）
Ch13-14 泼墨江：水墨写意（墨分五色）
Ch15-16 天镜泽：镜面银蓝（天地倒置）
Ch17    归途：五行交汇（暖光过渡）
Ch18    曲率崖再访：灰蓝→银线刺破
Ch19-21 霜灯峰：冰蓝+金顶日出
Ch22-24 收割者之战：冰蓝→青绿爆发→白金修复
Ch25    边境石碑：青绿→远方城市暖光
```

### 3.4 CaptainCast品牌配色（用于片头片尾/UI元素）

- 背景黑金：`#0a0a16`（深邃蓝黑）
- 金色点缀：`#c8a96e`
- 水墨质感 + 霓虹光效

### 3.5 "七彩"原则

七彩不是花花绿绿，是：
- 敦煌壁画的七彩：矿物颜料千年风化后的沉稳浓艳
- 九寨沟五彩池的七彩：水中矿物质折射的液态光谱
- 张掖丹霞的七彩：地壳运动亿年尺度的情绪沉积
- 极光的七彩：太阳风与磁场碰撞的宇宙级色彩

**每种色彩都有来源、有逻辑、有"为什么是这个颜色"的故事。**

---

## 四、核心角色视觉速查

从角色圣经提取的生图关键信息：

### 麦洛（主角，14岁少女）
- **标志现象**: 笑时周围灵机扩散（水变色、花绽放、草倒向她）；哭时灵机收缩、周围变暗
- **身体语言**: 咬下唇（在做决定）、握拳但不举起（想反抗但还不敢）
- **视觉签名**: 灵机纯度最高的光芒——但她自己看不见
- **关键搭配**: 灵宠小墨（墨龙），常缠绕手腕或肩头

### 维塔（墨龙小墨）
- **外形**: 墨色小龙，身长约30cm，全身漆黑如浓墨
- **视觉签名**: 眼睛颜色随情绪变（平静=琥珀金，警惕=赤红，伤感=银蓝）

### 其他角色
详见 `01_Characters/book1_character_bible.md`，包含：阿澈（透明骨少年）、凛冬（冰蓝眼瞳守桥人）、老孟（持烟杆老人）、沈暮寒（白发暗线角色）、船长（创世者）

---

## 五、单集制作流程建议

### 每集对应1章，25章 = 25集

**Step 1: 拆分场景**
- 读取对应章节正文（txt版本更干净）
- 按场景转换拆为4-8个关键画面
- 参考 `book1_visual_design.md` 中该章的"核心视觉奇观"描述

**Step 2: 生成画面Prompt**
- 基础模板：`[场景描述], [角色动作], [色彩方案from视觉设计文档], Chinese ink wash meets cyberpunk, Dunhuang mural color palette, cinematic 16:9`
- 必须包含该章的主色调Hex值作为色彩锚点
- 每章的"独特视觉语言"是该场景区别于其他章的视觉DNA

**Step 3: 配音文本**
- 从正文提取关键对白和旁白
- 船长（旁白）+ 麦洛（对白）为最高频声线
- 声音克隆已就绪（详见CaptainCast技术栈）

**Step 4: 合成**
- 画面 + 配音 + 字幕 → 短视频（2-5分钟/集）
- 片头片尾使用CaptainCast品牌配色（黑金底+金色标题）

---

## 六、逐章场景速览

以下为每章的核心画面提示（详细版在 `book1_visual_design.md`）：

| 章 | 标题 | 场景 | 核心画面关键词 |
|----|------|------|--------------|
| 01 | 入画 | 九色渊 | 少女从液态极光中浮出水面，五色水珠从发梢滑落，远处玉质山脉 |
| 02 | 听竹 | 瑶林 | 月光下半透明灵竹林同步脉动薄荷色光，羌绣村落烟火气 |
| 03 | 幻破 | 珠瀑崖 | 少女踩着弹射的灵机珍珠向上攀登，脚底彩虹共振光环 |
| 04 | 倒悬 | 万剑墟 | 倒悬的剑阵，冷银金属光泽，重力异常空间 |
| 05 | 隼啸 | 万剑墟 | 隼鸟俯冲，暗金+冷银色调的速度感 |
| 06 | 横舟 | 云海 | 乳白云海中横渡小舟，极光彩在云隙间流动 |
| 07 | 墨鹿 | 悬松岭 | 纯水墨画风——白雪黑松间一头墨色鹿 |
| 08 | 蟒影 | 悬松岭 | 水墨飞白技法，巨蟒暗影在松林间穿行 |
| 09 | 崖闻 | 曲率崖 | 灰蓝单色压迫感，时空扭曲的视觉变形 |
| 10 | 佛问 | 千佛崖 | 敦煌矿彩壁画活化，佛像睁眼的瞬间 |
| 11 | 千目 | 千佛崖 | 千尊佛像同时亮起千只眼睛，赤金赭蓝色调 |
| 12 | 虫心 | 赤霞壁 | 张掖丹霞般的大地七彩热烈色，虫群聚散 |
| 13 | 墨渡 | 泼墨江 | 泼墨写意，墨分五色，江面浓淡如画 |
| 14 | 补天 | 泼墨江 | 墨色裂开露出青蓝天光，补天的壮阔 |
| 15 | 镜碎 | 天镜泽 | 天地倒置的镜面湖，银蓝色调，镜面碎裂瞬间 |
| 16 | 抱影 | 天镜泽 | 破碎镜面中拥抱自己影子的少女 |
| 17 | 试刀 | 归途 | 五行色彩交汇的暖光过渡，试刀的利落 |
| 18 | 再闻 | 曲率崖 | 灰蓝重访，但这次有银线刺破黑暗 |
| 19 | 霜灯 | 霜灯峰 | 冰蓝山峰上的灯火，温暖与寒冷的极致对比 |
| 20 | 金散 | 霜灯峰 | 金色灵机粒子四散消融的壮美 |
| 21 | 燃灯 | 霜灯峰 | 金顶日出，点燃万盏霜灯的仪式感 |
| 22 | 天裂 | 收割者之战 | 冰蓝天穹裂开，几何体收割者降临 |
| 23 | 不怕 | 收割者之战 | 青绿灵机大爆发，少女逆光站立 |
| 24 | 山海谣 | 收割者之战 | 白金修复光波扩散，山海世界重建 |
| 25 | 千里 | 边境石碑 | 青绿渐变远方城市暖光，千里江山回望 |

---

## 七、生图Prompt模板

### 通用前缀
```
{scene description}, {character action},
Chinese ink wash painting meets cyberpunk aesthetic,
Dunhuang mural mineral pigment colors,
[该章主色调hex],
cinematic composition, 4K, 16:9
```

### 示例 — Ch1 入画
```
A 14-year-old Chinese girl emerging from luminous nine-colored water,
five different colored water droplets sliding from her hair tips each refracting a micro-rainbow,
jade-green crystalline mountains in the background glowing with warm scattered light,
faint translucent data grid rotating in the highest sky like a cosmic dome,
Chinese ink wash painting meets cyberpunk aesthetic,
Dunhuang mural mineral pigment colors,
dominant palette: emerald #3CB371 to amber #FFBF00 to sky blue #87CEEB,
underwater aurora lighting with warm color temperature,
cinematic composition, 4K, 16:9
```

### 示例 — Ch7 墨鹿
```
Pure Chinese ink wash style, a luminous ink-black deer standing among snow-covered ancient pines,
white snow contrasting deep black ink strokes with flying-white brush technique,
minimalist monochrome palette with subtle gray gradients,
single dot of warm amber for the deer's eye,
traditional shuimo painting meets digital art,
cinematic composition, 4K, 16:9
```

---

## 八、注意事项

1. **一致性**: 麦洛的外貌在25集中必须保持一致（14岁中国少女，黑长发，灵机光芒围绕）
2. **色彩连续性**: 相邻章节的色调应有过渡感，不要跳跃太大
3. **灵机可视化**: 灵机在不同场景有不同形态（液态/植物/粒子/矿物/气态/镜面），参考visual_design.md
4. **内容红线**:
   - ✅ 情感真实
   - ✅ 美学极致
   - ✅ 结尾有向上力量
   - ❌ 不为虐而虐
   - ❌ 不低俗
   - ❌ 不说教
5. **品牌水印**: 每张图右下角预留CaptainCast logo位置

---

## 九、协同接口

- **本指南位置**: `/Users/wyon/root/code-ai/godrise/07_AI_Manga/PRODUCTION_GUIDE.md`
- **CaptainCast项目**: `/Users/wyon/root/code-ai/CaptainCast/`
- **Blitz10交付目录**: `/Users/wyon/root/code-ai/CaptainCast/blitz10/`
- **Web阅读器（已部署）**: https://godrise.pages.dev

如需更多细节，直接读取上述索引的源文件。
