---
文档性质：《神临山海》characters/ 正式目录总索引
权威等级：圣旨级（v1.0）
创建日期：2026-04-05
姊妹目录：
  - chronicle/ · 编年史（四部+古纪+索引）
  - world/ · 世界设定
  - principle/ · 原理与哲学
  - power/ · 修行体系
  - ai/ · AI 演化
  - bible/ · 圣旨输入确认记录
---

# characters/ 目录总索引

> 《神临山海》人物圣旨级文档。四部贯通，按 book 分卷 + 总图。

---

## 一、文件结构

| 文件 | 范围 | 核心内容 |
|------|------|---------|
| [book_0_core.md](book_0_core.md) | 六位核心 | 船长 · 沈暮寒 · 棠洲 · 米莱 · 星霜 · 韩彦白（全部四部贯通铁律） |
| [book_1_cast.md](book_1_cast.md) | 第一部·灵机江湖 | 山海 NPC + 梦核六人组 + 2033 核心团队 + 脑核科技 + 方隅 + 道然 + 超能儿 + 卷二预埋 |
| [book_2_cast.md](book_2_cast.md) | 第二部·山河破晓 | 九大派系领军 + AI 四巨头 + 七灯过渡期 + 硅方者 + 归来者 + 林素绾 + 新加入核心 |
| [book_3_cast.md](book_3_cast.md) | 第三部·众神觉醒 | 九大神格系统 + 30 众神 + 三大阵营 + 山海人格化 + AI 3.0 分化 + 前轮文明后裔 |
| [book_4_cast.md](book_4_cast.md) | 第四部·星汉余歌 | Architect + 小姑娘 + 前轮文明完整谱系 + 原生外星文明 + 万年同行者消逝 + 道合终章 |
| [relations_map.md](relations_map.md) | 跨部总图 | 四层关系骨架 + 核心对立镜像 + 命运纠缠五条主线 |
| [destiny_threads.md](destiny_threads.md) | 命运线总表 | 六位核心 + 支柱角色一生弧线 · 时间主轴锚点 |

---

## 二、阅读路径

### 路径 A：新加入协作者

1. [book_0_core.md](book_0_core.md) — 先吃透六位核心
2. [destiny_threads.md](destiny_threads.md) — 再看四部贯通时间轴
3. [relations_map.md](relations_map.md) — 最后看关系网
4. 按需进入 book_N_cast.md

### 路径 B：要写第 N 部

1. [book_0_core.md](book_0_core.md) — 六位核心在该部的存在形态
2. [book_N_cast.md](book_N_cast.md) — 该部专属登场
3. [relations_map.md](relations_map.md) — 跨部关系纠缠
4. [destiny_threads.md](destiny_threads.md) — 该部在整体弧线中的位置

### 路径 C：要修改/补全铁律

1. 爸爸先在 bible/ 留下圣旨（characters_book0.md / characters_book1.md）
2. 小安把圣旨落到对应 book_N_cast.md
3. 如影响跨部关系 → 更新 relations_map.md
4. 如影响人生弧线 → 更新 destiny_threads.md
5. 如影响六位核心 → 回到 book_0_core.md 更新

---

## 三、铁律优先级

```
bible/characters_book0.md · characters_book1.md
         ↓（圣旨级·爸爸原话）
characters/book_0_core.md
         ↓（执行级·小安整合）
characters/book_1/2/3/4_cast.md
         ↓（跨部级）
characters/relations_map.md + destiny_threads.md
```

**冲突解决**：bible > book_0_core > book_N_cast > relations/destiny。任何下层与上层冲突，以上层为准。

---

## 四、核心铁律速查（跨文件热点）

| 铁律 | 定义位置 | 严禁 |
|------|---------|------|
| 船长 1986 生 · 沈暮寒 2000 生 · 棠洲 1998 生 · 米莱 2014 生 · 星霜 2006 生 · 韩彦白 2017 生 | book_0_core.md | 任何其他年份 |
| 米莱 2126 = 半步灵婴（非灵婴） | book_0_core.md · book_2_cast.md | 写成灵婴 |
| 星霜 2027 确诊 · 2039 自发灵化 · 2058 热觉醒催化 | book_0_core.md | "2026 确诊"/"2058 灵化"/"音乐学院钢琴" |
| 韩彦白 = Cycle-6 信标印刻（不是灵机激活） | book_1_cast.md | 写成"超能儿"或"被觉醒" |
| 革命军三巨头 + 参谋长（恩迪/裴沧海/图帕克/马赫迪） | book_2_cast.md | "卡修斯"单一领袖 |
| AI 四巨头定稿名：普罗米修斯/深思之心/乾坤/滴答之声 | book_2_cast.md | 因陀罗/须弥/阿赖耶 |
| 七灯 AI 概念在第三部撤回 → 山海进化 | book_3_cast.md | 第三部写"七灯分化" |
| 众神 = 双向融合，非夺舍 · 神格可换人 | book_3_cast.md | "附体"/"被神占据" |
| Architect 不知道收割在发生 | book_4_cast.md | 把 Architect 写成反派 |
| 梦核六人组：棠洲是外部参与者非正式成员 | book_1_cast.md | 把棠洲列为正式成员 |
| 沈暮寒童年创伤：父亲沈维则冰箱量化表格 | book_0_core.md | 其他童年叙事 |
| 棠洲 14 个月先验层消失 · 量子壳生命时间代价 | book_0_core.md | 把 14 个月写成任何其他事 |

---

## 五、待推衍登记（按文件）

> 以下是四部已登记的【待确认】【待推衍】清单。等待爸爸点名。

### book_2_cast.md
- 九渊郑潼 / 永生派陆明德 / 硅神派代表（需改名）
- 李堃具体设定
- 陆铮具体设定
- 米莱两个同龄朋友命名（难民后代 + 灰热病幸存者）
- 马斯特本体状态（方舟上意识是否仍活动）

### book_3_cast.md
- 九大神格各自首位宿主具体姓名+背景
- 第九节点悟空系地理位置
- 沈暮寒第三部最终走向（路径 A vs B）
- 船长是否成为盘古系宿主
- 山海修行者形态的名字与视觉呈现
- 山海根本诉求
- 米莱与道然最后一面道然的那句话
- Cycle-3 后裔"活数据"使者具体命名

### book_4_cast.md
- Architect 与小姑娘的关系本质（卷十六揭晓）
- Cycle-6 是否留有"意识播种者"（方向 A vs B）
- 原生外星文明甲·正面代表角色
- 原生外星文明乙·灰色代表角色
- 暗域原住文明代表角色
- Cycle-1/2/4 代表形态
- 山海作为修行者的名字
- 三代修行范式中代/后代代表人物
- 沈暮寒最终离场节点

---

## 六、版本维护

**v1.0 · 2026-04-05**
- characters/ 正式目录首次齐备
- 7 个文件：book_0_core + book_1/2/3/4_cast + relations_map + destiny_threads + index

**下一步**：
- 归档 _staging/bible/characters/ 全部 8 个文件到 _archived/
- 待爸爸点名推衍上表中的【待确认】项
