#!/usr/bin/env node
/**
 * 扫描 chapters.json 中所有 md 文件，离线预计算字数统计，产出 web/stats.json
 * 使用：在 godrise 根目录执行 `node scripts/build_stats.js`
 * 结果：减少首页从 ~187 个并发 fetch 到 1 个 fetch，首页秒开
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHAPTERS = path.join(ROOT, 'web', 'chapters.json');
const OUT = path.join(ROOT, 'web', 'stats.json');

function flatten(encyclopedia) {
    const flat = [];
    (encyclopedia.sections || []).forEach((section) => {
        if (section.type === 'chapters') {
            (section.books || []).forEach((book) => {
                (book.chapters || []).forEach((ch) => {
                    if (ch.file) flat.push({ file: ch.file, type: 'chapter' });
                });
            });
        } else if (section.items) {
            section.items.forEach((it) => {
                if (it.file) flat.push({ file: it.file, type: 'setting' });
            });
        }
    });
    return flat;
}

// 与前端 updateStats 的算法一致：去掉 markdown 标记和空白后按字符数计
function countWords(text) {
    const clean = text
        .replace(/^#+\s.*$/gm, '')
        .replace(/[#*_`\[\]()>|\-\n\r\s]/g, '');
    return clean.length;
}

function main() {
    if (!fs.existsSync(CHAPTERS)) {
        console.error('❌ 找不到', CHAPTERS);
        process.exit(1);
    }
    const json = JSON.parse(fs.readFileSync(CHAPTERS, 'utf-8'));
    const enc = json.encyclopedia || json;
    const items = flatten(enc);

    const files = {};
    let chapterWords = 0;
    let settingWords = 0;
    let missing = 0;

    for (const it of items) {
        const abs = path.join(ROOT, it.file);
        if (!fs.existsSync(abs)) {
            files[it.file] = 0;
            missing++;
            continue;
        }
        const text = fs.readFileSync(abs, 'utf-8');
        const wc = countWords(text);
        files[it.file] = wc;
        if (it.type === 'chapter') chapterWords += wc;
        else settingWords += wc;
    }

    const out = {
        generatedAt: new Date().toISOString(),
        itemCount: items.length,
        missing,
        totals: {
            chapterWords,
            settingWords,
            totalWords: chapterWords + settingWords
        },
        files
    };

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf-8');
    console.log('✅ stats.json 已生成');
    console.log(`   文档数 ${items.length} · 缺失 ${missing}`);
    console.log(`   设定 ${settingWords.toLocaleString()} · 正文 ${chapterWords.toLocaleString()} · 总计 ${(chapterWords + settingWords).toLocaleString()}`);
}

main();
