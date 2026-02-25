# Web阅读器使用说明

## 快速开始

### 方法1：使用Python HTTP服务器（推荐）

```bash
cd web-reader
python3 -m http.server 8000
```

然后在浏览器中访问：`http://localhost:8000`

### 方法2：使用Node.js serve

```bash
cd web-reader
npx serve .
```

### 方法3：使用其他静态服务器

任何支持静态文件的HTTP服务器都可以，例如：
- `php -S localhost:8000`
- `ruby -run httpd . -p 8000`

## 功能说明

### 1. 章节导航
- 左侧边栏显示所有章节
- 按部曲分组显示
- 点击章节即可阅读

### 2. 搜索功能
- 在搜索框输入关键词
- 自动搜索所有章节内容
- 显示匹配的片段和位置
- 点击搜索结果跳转到对应章节

### 3. 主题切换
- 支持亮色/暗色模式
- 自动保存偏好设置

### 4. 导航控制
- 上一章/下一章按钮
- 移动端友好的侧边栏

## 配置章节列表

编辑 `chapters.json` 文件，添加你的章节信息：

```json
{
  "chapters": [
    {
      "book": "第一部：降临",
      "chapters": [
        {
          "title": "第一章：标题",
          "file": "../02_Drafts/Book1_灵机江湖/Chapter_001_入画.md",
          "wordCount": 3000
        }
      ]
    }
  ]
}
```

## 注意事项

1. **文件路径**：章节文件的路径是相对于 `index.html` 的
2. **Markdown支持**：阅读器支持基本的Markdown格式
3. **CORS限制**：如果直接打开HTML文件（file://），可能无法加载章节文件，必须使用HTTP服务器

## 自定义样式

编辑 `styles.css` 可以自定义阅读器的外观和样式。

## 故障排除

### 章节无法加载
- 检查 `chapters.json` 中的文件路径是否正确
- 确保使用HTTP服务器而不是直接打开HTML文件
- 检查浏览器控制台的错误信息

### 搜索功能不工作
- 确保章节文件可以正常访问
- 检查文件编码是否为UTF-8
