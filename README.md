# 《神临山海》- Novel as Code 项目

> 史诗级硬科幻四部曲 | 总计160万字 | AI协作创作

## 项目理念

这是一个**"像写代码一样写小说"**的实验性项目。整个小说以代码项目的方式组织，利用 Cursor AI 的全库索引能力，实现 AI 对整部作品的"全知全能"式协作。

## 目录结构

```
神临山海/
├── .cursorrules              # AI全局指令（核心配置文件）
├── README.md                 # 本文件
│
├── 00_World_Bible/           # 世界观数据库
│   ├── technology.md        # 科技树与物理规则
│   ├── geography.md         # 地理/星际设定
│   ├── history.md           # 历史时间线
│   ├── society.md           # 社会结构
│   └── rules.md             # 核心规则设定
│
├── 01_Characters/            # 人物数据库
│   ├── protagonist_main.md  # 主角档案
│   ├── antagonist_main.md   # 反派档案
│   ├── supporting.md        # 配角档案
│   └── relations_map.md     # 关系网络图
│
├── 02_Drafts/                # 正文草稿
│   ├── Book1_The_Arrival/   # 第一部：降临
│   ├── Book2_The_Conflict/  # 第二部：冲突
│   ├── Book3_The_Revelation/# 第三部：启示
│   └── Book4_The_Ascension/ # 第四部：升华
│
├── 03_Archives/              # 废弃稿/灵感碎片
│
├── 04_Outlines/              # 大纲与情节追踪
│   ├── overall_outline.md   # 总体大纲
│   ├── plot-threads.md      # 伏笔追踪
│   └── chapter_notes.md     # 章节笔记
│
├── 05_Reference/             # 参考素材库
│   ├── style_samples/       # 风格参考片段
│   ├── scene_templates/     # 场景模板
│   └── research/            # 研究资料
│
└── web-reader/               # Web阅读器
    ├── index.html
    ├── reader.js
    └── styles.css
```

## 使用指南

### 1. 在 Cursor 中写作

#### 基础协作
```
# 引用设定文档
"参考 @00_World_Bible/technology.md 中的曲率引擎原理，描写一段启动场景"

# 引用人物档案
"根据 @01_Characters/protagonist_main.md，写一段主角的内心独白"

# 多文件协作
"主角在 @02_Drafts/Book1_The_Arrival/Chapter_050.md 中受伤，
请更新 @01_Characters/protagonist_main.md 的状态记录"
```

#### 一致性检查
```
# 使用 Codebase 搜索
"搜索全库，我之前在哪些章节提到过'黑曜石方尖碑'？现在的描写是否冲突？"

# 人物关系检查
"检查 @01_Characters 中所有人物，有没有被遗忘的角色？"
```

#### 情节规划
```
# 大纲协作
"根据 @04_Outlines/overall_outline.md，帮我构思第3章的具体情节"

# 伏笔管理
"在 @04_Outlines/plot-threads.md 中记录这个新伏笔"
```

### 2. Web 阅读器使用

#### 启动本地服务器
```bash
cd web-reader
python3 -m http.server 8000
# 或
npx serve .
```

#### 访问
打开浏览器访问：`http://localhost:8000`

#### 功能
- 📖 自动扫描 `02_Drafts/` 目录下的所有章节
- 🔍 支持全文搜索
- 📑 目录导航
- 🌙 暗色/亮色主题切换
- 📱 响应式设计，支持移动端

### 3. 版本控制

建议使用 Git 管理整个项目：

```bash
git init
git add .
git commit -m "初始化《神临山海》项目"
```

**分支策略建议**：
- `main` - 主分支（稳定版本）
- `book1-draft` - 第一部草稿分支
- `book2-draft` - 第二部草稿分支
- `experimental` - 实验性情节分支

## 工作流程

### 日常写作流程

1. **准备阶段**（5分钟）
   - 打开相关设定文档
   - 回顾前文关键信息
   - 确认当前章节目标

2. **协作阶段**
   - 使用 `@` 引用相关文档
   - 明确写作要求
   - AI 生成初稿

3. **检查阶段**（10-15分钟）
   - 使用一致性检查清单
   - 标记需要修改的地方
   - 记录到写作日志

4. **修订阶段**
   - 修正不一致内容
   - 更新设定文档（如有新设定）
   - 提交到版本控制

### 阶段性工作

- **每周**：回顾本周进度，检查人物发展轨迹
- **每月**：进行一致性审计，检查设定冲突
- **每部完成**：全面回顾，确保伏笔呼应

## 核心优势

1. **无限记忆**：AI 可以随时检索整个项目的任何内容
2. **动态设定**：设定文档与正文同步更新
3. **版本控制**：像代码一样管理剧情分支
4. **一致性保证**：自动检查人物、设定、情节的一致性

## 注意事项

- `.cursorrules` 文件是核心，定义了 AI 的行为规范
- 每次添加新设定，必须更新对应的设定文档
- 重要决策要记录在 `04_Outlines/` 中
- 定期使用 Git 提交，便于回溯

## 贡献与反馈

这是一个实验性项目，欢迎提出改进建议！

---

**开始创作吧！让 AI 成为你最强大的创作伙伴。** 🚀
