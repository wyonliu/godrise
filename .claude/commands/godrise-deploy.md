# 神临山海·一键部署

提交当前变更并部署到 godrise.pages.dev。

## 执行流程

1. `git status` 查看变更
2. `git diff` 查看具体改动
3. 生成简洁的中文 commit message
4. `git add` 相关文件（不加 .env / credentials 等敏感文件）
5. `git commit`
6. `git push origin main`
7. `npx wrangler pages deploy . --project-name godrise --branch main`
8. 验证部署成功

## 注意
- commit message 用中文，简明扼要
- 末尾加 Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- 如果没有变更，不创建空提交
