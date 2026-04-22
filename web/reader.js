/**
 * 《神临山海》Web阅读器核心逻辑 V5.0 - 完美版
 */

const state = {
    encyclopedia: null,
    currentItem: null,
    currentDocPath: '',
    searchHighlight: '',
    allItems: [],
    viewCount: parseInt(localStorage.getItem('viewCount') || '0'),
    readStartTime: Date.now(),
    pageReadStart: Date.now(),
    totalReadTime: parseInt(localStorage.getItem('totalReadTime') || '0'),
    pageReadTimes: JSON.parse(localStorage.getItem('pageReadTimes') || '{}'),
    comments: JSON.parse(localStorage.getItem('comments') || '[]'),
    inlineComments: JSON.parse(localStorage.getItem('inlineComments') || '{}'),
    user: JSON.parse(localStorage.getItem('slsh_user') || 'null'),
    cachedChapterWords: 0,
    cachedSettingWords: 0,
    commentSidebarOpen: false,
    apiAvailable: null,
    // 文档内存缓存：path -> markdown text；命中即 0 延迟渲染
    _docCache: Object.create(null),
    // 正在进行的 fetch Promise：去重并发请求
    _fetchInflight: Object.create(null),
    // 当前 loadItem 序号：后发起的请求会取消前面未完成的渲染
    _loadSeq: 0
};

/**
 * 带缓存 + 并发去重 + 30s 超时 + 单次重试 的文档获取
 * @param {string} path 文档路径
 * @returns {Promise<string>} markdown 原文
 */
async function fetchDoc(path) {
    if (state._docCache[path]) return state._docCache[path];
    if (state._fetchInflight[path]) return state._fetchInflight[path];

    const doFetch = async (attempt) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error('加载超时（30秒），请检查网络')), 30000);
        try {
            const res = await fetch(path, { signal: ctrl.signal, cache: 'default' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const text = await res.text();
            state._docCache[path] = text;
            return text;
        } finally {
            clearTimeout(timer);
        }
    };

    const promise = (async () => {
        try {
            return await doFetch(1);
        } catch (e1) {
            // 第一次失败（含超时/网络抖动），等 400ms 再试一次
            await new Promise(r => setTimeout(r, 400));
            return await doFetch(2);
        }
    })().finally(() => {
        delete state._fetchInflight[path];
    });

    state._fetchInflight[path] = promise;
    return promise;
}

/**
 * 空闲时预取相邻章节，翻页秒开
 */
function prefetchNeighbors(currentIdx) {
    const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
    schedule(() => {
        const neighbors = [currentIdx + 1, currentIdx - 1, currentIdx + 2];
        for (const idx of neighbors) {
            if (idx < 0 || idx >= state.allItems.length) continue;
            const it = state.allItems[idx];
            if (!it || !it.file) continue;
            const p = resolvePath(it.file);
            if (state._docCache[p] || state._fetchInflight[p]) continue;
            fetchDoc(p).catch(() => {}); // 预取失败静默
        }
    }, { timeout: 2000 });
}

async function apiCall(endpoint, method, body) {
    try {
        const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(endpoint, opts);
        if (!res.ok) throw new Error(res.status);
        state.apiAvailable = true;
        return await res.json();
    } catch (e) {
        if (state.apiAvailable === null) state.apiAvailable = false;
        return null;
    }
}

async function syncCommentsFromCloud() {
    const data = await apiCall('/api/comments');
    if (data && Array.isArray(data)) {
        state.comments = data;
        localStorage.setItem('comments', JSON.stringify(data));
    }
}

async function syncInlineFromCloud(pageKey) {
    if (!pageKey) return;
    const data = await apiCall('/api/inline-comments?page=' + encodeURIComponent(pageKey));
    if (data && Array.isArray(data)) {
        state.inlineComments[pageKey] = data;
        localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments));
    }
}

async function pushInitialToCloud() {
    if (state.comments.length > 0) {
        await apiCall('/api/comments', 'POST', { action: 'sync', comments: state.comments });
    }
    for (const [key, arr] of Object.entries(state.inlineComments)) {
        if (arr.length > 0) {
            await apiCall('/api/inline-comments', 'POST', { page: key, action: 'sync', comments: arr });
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📖 《神临山海》系统启动...');
    await bootApp();
});

async function bootApp() {
    updateUserDisplay();
    await loadEncyclopedia();
    initUI();
    initTheme();
    setupNavigation();
    setupSearch();
    setupKeyboardShortcuts();
    setupInlineComments();
    setupCommentSidebar();
    setupSwipeNavigation();
    startReadTimeTracking();
    state.viewCount++;
    localStorage.setItem('viewCount', state.viewCount);
    restorePageFromHash();

    syncCommentsFromCloud().then(() => {
        if (state.apiAvailable === false && state.comments.length > 0) {
            pushInitialToCloud();
        }
        renderComments();
    });
}

/**
 * 从URL hash恢复页面状态
 * 支持简洁路径： #category/slug 或 #category/slug#anchor ；互动中心 #interaction
 * 兼容旧格式： #{"sIdx":0,"idx1":0,...}
 */
function restorePageFromHash() {
    const raw = window.location.hash;
    // 空 hash = 首页，触发 goHome 恢复 hero（修 v52：浏览器后退到空 hash 时原本卡住）
    if (!raw || raw.length <= 1) {
        if (typeof goHome === 'function' && window.__HERO_HTML) {
            const contentArea = document.getElementById('content');
            // 只有当前不是 hero 时才恢复，避免无意义刷新；fromHistory=true 不 push
            if (contentArea && !contentArea.querySelector('.welcome-hero')) {
                goHome(true);
            }
        }
        return;
    }
    const h = raw.substring(1);
    // 互动中心
    if (h === 'interaction') {
        showInteractionPage();
        return;
    }
    // 简洁路径：xxx/yyy 或 xxx/yyy#zzz
    const sharp = h.indexOf('#');
    const pathPart = sharp >= 0 ? h.substring(0, sharp) : h;
    let anchorPart = sharp >= 0 ? h.substring(sharp + 1) : '';
    try { anchorPart = decodeURIComponent(anchorPart); } catch (e) { }
    if (pathPart.includes('/') && !pathPart.startsWith('{')) {
        const [category, slug] = pathPart.split('/').map(s => decodeURIComponent(s));
        const found = findItemByPath(category, slug);
        if (found) {
            loadItem(found.sIdx, found.idx1, found.idx2, found.type, anchorPart || undefined);
            return;
        }
    }
    // 兼容旧 JSON hash
    try {
        const hashData = JSON.parse(decodeURIComponent(h));
        if (hashData.page === 'interaction') {
            showInteractionPage();
            return;
        }
        if (typeof hashData.sIdx === 'number') {
            loadItem(hashData.sIdx, hashData.idx1, hashData.idx2, hashData.type);
        }
    } catch (e) {
        // 忽略
    }
}

// 监听hash变化（支持前进后退）
window.addEventListener('hashchange', () => {
    restorePageFromHash();
});

/**
 * 阅读时长追踪
 */
function startReadTimeTracking() {
    setInterval(() => {
        const elapsed = Math.floor((Date.now() - state.readStartTime) / 1000);
        state.totalReadTime = parseInt(localStorage.getItem('totalReadTime') || '0') + 1;
        localStorage.setItem('totalReadTime', state.totalReadTime);
    }, 1000);
}

function trackPageReadTime() {
    if (state.currentItem) {
        const pageKey = `${state.currentItem.sIdx}-${state.currentItem.idx1}-${state.currentItem.idx2}`;
        const elapsed = Math.floor((Date.now() - state.pageReadStart) / 1000);
        state.pageReadTimes[pageKey] = (state.pageReadTimes[pageKey] || 0) + elapsed;
        localStorage.setItem('pageReadTimes', JSON.stringify(state.pageReadTimes));
        state.pageReadStart = Date.now();
    }
}

/**
 * 加载百科全书数据
 */
async function loadEncyclopedia() {
    const nav = document.getElementById('chapterNav');
    try {
        console.log('📥 开始加载目录...');
        // v58 性能修复：去掉 Date.now() cache-bust，改用版本号参数让 HTTP 缓存生效
        // （chapters.json 由构建脚本生成，改动时手工提 v 即可；刷新时走 304/强缓存）
        const response = await fetch('web/chapters.json?v=61', { cache: 'default' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        
        const text = await response.text();
        console.log('📄 JSON文本长度:', text.length);
        const json = JSON.parse(text);
        console.log('✅ JSON解析成功');
        
        state.encyclopedia = json.encyclopedia || json;
        console.log('📚 百科全书对象:', state.encyclopedia ? '存在' : '不存在');
        console.log('📋 sections数量:', state.encyclopedia?.sections?.length || 0);
        
        state.allItems = flattenEncyclopedia(state.encyclopedia);
        console.log('📝 扁平化后项目数:', state.allItems.length);
        
        renderNavigation(state.encyclopedia);
        console.log('✅ 目录加载成功，共', state.allItems.length, '项');
        
        // 延迟更新统计，不阻塞初始加载
        setTimeout(() => {
            updateStats().catch(e => console.warn('统计更新失败:', e));
        }, 100);
    } catch (error) {
        console.error('❌ 加载失败:', error);
        console.error('错误堆栈:', error.stack);
        if (nav) {
            nav.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--text-muted);">加载失败<br><small>${error.message}</small><br><small style="font-size: 0.8em; margin-top: 0.5rem;">请检查浏览器控制台获取详细信息</small></div>`;
        }
    }
}

function flattenEncyclopedia(data) {
    const flat = [];
    data.sections?.forEach((section, sIdx) => {
        if (section.type === 'chapters') {
            section.books?.forEach((book, bIdx) => {
                book.chapters?.forEach((ch, cIdx) => {
                    const slug = ch.slug || `${bIdx + 1}-${String(cIdx + 1).padStart(3, '0')}`;
                    flat.push({
                        ...ch,
                        slug,
                        category: 'chapters',
                        type: 'chapter',
                        sIdx,
                        bIdx,
                        cIdx,
                        sectionTitle: section.title,
                        bookTitle: book.book
                    });
                });
            });
        } else {
            section.items?.forEach((item, iIdx) => {
                const slug = item.slug || (item.file || '').replace(/\.md$/, '').split('/').pop().replace(/_/g, '-') || `item-${iIdx}`;
                flat.push({
                    ...item,
                    slug,
                    category: section.type,
                    type: section.type,
                    sIdx,
                    iIdx,
                    sectionTitle: section.title
                });
            });
        }
    });
    return flat;
}

/** 从当前项得到 URL 路径：category/slug */
function getPathFromItem(item) {
    if (!item) return '';
    const cat = item.category || (item.type === 'chapter' ? 'chapters' : item.type);
    const sl = item.slug || (item.type === 'chapter' ? `${(item.bIdx || 0) + 1}-${String((item.cIdx || 0) + 1).padStart(3, '0')}` : `item-${item.iIdx ?? 0}`);
    return `${cat}/${sl}`;
}

/** 根据路径 category/slug 查找项，返回 { item, sIdx, idx1, idx2, type } */
function findItemByPath(category, slug) {
    const type = category === 'chapters' ? 'chapter' : category;
    const idx = state.allItems.findIndex(i => {
        const c = i.category || (i.type === 'chapter' ? 'chapters' : i.type);
        const s = i.slug || (i.type === 'chapter' ? `${(i.bIdx || 0) + 1}-${String((i.cIdx || 0) + 1).padStart(3, '0')}` : `item-${i.iIdx ?? 0}`);
        return c === category && s === slug;
    });
    if (idx < 0) return null;
    const item = state.allItems[idx];
    return {
        item,
        sIdx: item.sIdx,
        idx1: item.type === 'chapter' ? item.bIdx : item.iIdx,
        idx2: item.type === 'chapter' ? item.cIdx : -1,
        type: item.type
    };
}

function renderNavigation(data) {
    const nav = document.getElementById('chapterNav');
    if (!nav) return;
    
    nav.innerHTML = '';
    data.sections?.forEach((section, sIdx) => {
        const secEl = document.createElement('div');
        secEl.className = 'encyclopedia-section';
        secEl.dataset.sectionType = section.type || '';
        secEl.dataset.sectionIdx = sIdx;
        
        const titleEl = document.createElement('div');
        titleEl.className = 'section-title';
        titleEl.innerHTML = `<span>${section.title}</span>`;
        
        if (sIdx === 0) {
            titleEl.classList.add('active');
        }
        
        titleEl.onclick = () => {
            const isActive = titleEl.classList.toggle('active');
            if (isActive) {
                contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
                contentEl.classList.add('open');
            } else {
                contentEl.style.maxHeight = '0';
                contentEl.classList.remove('open');
            }
        };
        
        const contentEl = document.createElement('div');
        contentEl.className = 'section-content';
        
        if (section.type === 'chapters') {
            section.books?.forEach((book, bIdx) => {
                const bookTitle = document.createElement('div');
                bookTitle.className = 'book-title';
                bookTitle.textContent = book.book;
                contentEl.appendChild(bookTitle);
                
                book.chapters?.forEach((ch, cIdx) => {
                    contentEl.appendChild(createNavItem(ch.title, 'chapter', sIdx, bIdx, cIdx, '📄'));
                });
            });
        } else {
            section.items?.forEach((item, iIdx) => {
                contentEl.appendChild(createNavItem(item.title, section.type, sIdx, iIdx, -1, item.icon));
            });
        }
        
        if (sIdx === 0) {
            contentEl.classList.add('open');
            setTimeout(() => {
                contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
            }, 10);
        }
        
        secEl.appendChild(titleEl);
        secEl.appendChild(contentEl);
        nav.appendChild(secEl);
    });
}

function createNavItem(text, type, sIdx, idx1, idx2 = -1, icon = '') {
    const el = document.createElement('div');
    el.className = 'chapter-item';
    // 添加data属性用于精确匹配
    el.dataset.sIdx = sIdx;
    el.dataset.idx1 = idx1;
    el.dataset.idx2 = idx2;
    el.dataset.type = type;
    if (icon) {
        el.innerHTML = `<span class="nav-icon">${icon}</span><span class="nav-text">${text}</span>`;
    } else {
        el.textContent = text;
    }
    el.onclick = () => {
        trackPageReadTime();
        loadItem(sIdx, idx1, idx2, type);
    };
    return el;
}

/**
 * 加载具体内容
 * @param {string} [scrollAnchor] - 加载后滚动到的标题 id（页内锚点）
 */
async function loadItem(sIdx, idx1, idx2, type, scrollAnchor) {
    const contentArea = document.getElementById('content');
    const mySeq = ++state._loadSeq;

    closeRightPanel();
    state.currentItem = { sIdx, idx1, idx2, type };
    state.pageReadStart = Date.now();

    const item = state.allItems.find(i =>
        i.sIdx === sIdx &&
        (type === 'chapter' ? (i.bIdx === idx1 && i.cIdx === idx2) : i.iIdx === idx1)
    );
    if (!item) {
        contentArea.innerHTML = '<div style="text-align:center;padding:4rem;color:var(--text-muted);">未找到内容</div>';
        return;
    }

    const hashPath = getPathFromItem(item);
    window.location.hash = hashPath + (scrollAnchor ? '#' + scrollAnchor : '');

    const path = resolvePath(item.file);
    const cached = state._docCache[path];

    // 1. 立即发起 fetch（如果没缓存），与 UI 动画并行跑
    const docPromise = cached ? Promise.resolve(cached) : fetchDoc(path);

    // 2. 淡出动画 + loading 占位（命中缓存则跳过占位）
    contentArea.style.transition = 'opacity 0.15s';
    if (!cached) {
        contentArea.style.opacity = '0';
        // 仅在 150ms 内未命中时显示 loading，避免闪屏
        setTimeout(() => {
            if (state._loadSeq !== mySeq) return;
            if (state._docCache[path]) return; // 已到手
            contentArea.innerHTML = '<div class="page-loading" style="text-align:center;padding:4rem;color:var(--text-muted);">正在加载…</div>';
            contentArea.style.opacity = '1';
        }, 150);
    }

    let markdown;
    try {
        markdown = await docPromise;
    } catch (err) {
        if (state._loadSeq !== mySeq) return; // 已被更新请求取代
        console.error('[loadItem fetch]', err);
        const msg = (err && err.message) ? err.message : String(err);
        contentArea.innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="margin-bottom:1rem;">加载失败</div>
                <div style="font-size:0.85em;opacity:0.7;margin-bottom:1.5rem;">${msg}</div>
                <button class="chapter-nav-btn" id="retryLoadBtn">重试</button>
            </div>`;
        contentArea.style.opacity = '1';
        const retry = document.getElementById('retryLoadBtn');
        if (retry) retry.onclick = () => {
            delete state._docCache[path];
            delete state._fetchInflight[path];
            loadItem(sIdx, idx1, idx2, type, scrollAnchor);
        };
        return;
    }

    // 如果用户已切到别的页面，丢弃本次渲染
    if (state._loadSeq !== mySeq) return;

    const html = markdownToHTML(markdown);
    state.currentDocPath = item.file;

    const currentIdx = state.allItems.findIndex(i =>
        i.sIdx === sIdx &&
        (type === 'chapter' ? (i.bIdx === idx1 && i.cIdx === idx2) : i.iIdx === idx1)
    );
    const hasPrev = currentIdx > 0;
    const hasNext = currentIdx < state.allItems.length - 1;

    const isNovel = (type === 'chapter');
    // v58: 从章节信息推断"部"编号，用于视觉分层（data-book="1|2|3|4"）
    const bookNum = (() => {
        if (!isNovel) return '';
        // 优先从 slug（如 "1-001"）取首位数字
        if (item.slug) {
            const m = String(item.slug).match(/^(\d)/);
            if (m) return m[1];
        }
        // 回退：从 bookTitle 的"第X部"汉字
        if (item.bookTitle) {
            const map = { '一': '1', '二': '2', '三': '3', '四': '4' };
            const m = item.bookTitle.match(/第([一二三四])部/);
            if (m && map[m[1]]) return map[m[1]];
        }
        return '';
    })();
    const crumb = item.bookTitle
        ? `<span class="crumb-book">${item.bookTitle}</span><span class="crumb-sep">·</span><span class="crumb-item">${item.title}</span>`
        : `<span class="crumb-section">${(item.sectionTitle || '').replace(/^[^\w\u4e00-\u9fa5]+/, '').trim()}</span><span class="crumb-sep">·</span><span class="crumb-item">${item.title}</span>`;
    contentArea.innerHTML = `
        <div class="chapter-content${isNovel ? ' is-novel' : ''}"${bookNum ? ` data-book="${bookNum}"` : ''}>
            <div class="chapter-nav-top">
                <button class="chapter-nav-btn" id="topPrevBtn" ${!hasPrev ? 'disabled' : ''}>‹ 上一章</button>
                <span class="chapter-info-inline">${crumb}</span>
                <button class="chapter-nav-btn" id="topNextBtn" ${!hasNext ? 'disabled' : ''}>下一章 ›</button>
            </div>
            ${html}
            <div class="vote-section" id="voteContainer"></div>
            <div class="chapter-nav-bottom">
                <button class="chapter-nav-btn" id="bottomPrevBtn" ${!hasPrev ? 'disabled' : ''}>‹ 上一章</button>
                <span class="chapter-info-inline">${item.bookTitle || item.sectionTitle}</span>
                <button class="chapter-nav-btn" id="bottomNextBtn" ${!hasNext ? 'disabled' : ''}>下一章 ›</button>
            </div>
        </div>
    `;
    contentArea.style.opacity = '1';

    if (hasPrev) {
        document.getElementById('topPrevBtn').onclick = () => navigateChapter(-1);
        document.getElementById('bottomPrevBtn').onclick = () => navigateChapter(-1);
    }
    if (hasNext) {
        document.getElementById('topNextBtn').onclick = () => navigateChapter(1);
        document.getElementById('bottomNextBtn').onclick = () => navigateChapter(1);
    }

    updateActiveNavItem();
    setupInternalLinks();
    generatePageTOC();
    expandNavToCurrentItem();

    const readerContent = document.getElementById('readerContent');
    if (state.searchHighlight) {
        const searchData = state.searchHighlight;
        const query = typeof searchData === 'object' ? searchData.query : searchData;
        setTimeout(() => highlightAndScrollToSearch(query), 100);
        state.searchHighlight = null;
    } else if (scrollAnchor) {
        setTimeout(() => scrollToHeading(scrollAnchor), 150);
    } else {
        readerContent.scrollTop = 0;
    }
    initProgressTracker();
    initTOCScrollSpy();
    state._lastPath = getPathFromItem(item);

    const voteKey = getPageKey();
    renderVoteButton(voteKey);

    if (window.innerWidth <= 1024) {
        document.getElementById('sidebar').classList.remove('open');
    }
    if (window.innerWidth > 1024) {
        openRightPanel(false);
        switchRightPanelTab('toc');
    }

    // 空闲预取相邻章节（翻页秒开）
    prefetchNeighbors(currentIdx);
}

function resolvePath(file) {
    const isRoot = window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
    let path = file.replace(/^\.\.\//, '');
    return isRoot ? path : '../' + path;
}

function markdownToHTML(md) {
    // 配置marked.js
    marked.setOptions({
        breaks: true,          // 支持GitHub风格的换行
        gfm: true,             // 启用GitHub风格的Markdown
        tables: true,          // 支持表格
        smartLists: true,      // 智能列表
        smartypants: true,     // 智能标点
        headerIds: true,       // 标题添加ID（便于锚点跳转）
        mangle: false,         // 不混淆邮箱
        pedantic: false,       // 不使用原始markdown.pl的怪异行为
        highlight: function(code, lang) {
            // 代码高亮
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (err) {
                    console.error('Highlight error:', err);
                }
            }
            return hljs.highlightAuto(code).value;
        }
    });
    
    // 自定义渲染器：标题 ID 唯一化，避免同页重复标题（如多个「核心情节」）导致页内目录多高亮
    const renderer = new marked.Renderer();
    const usedIds = {};
    renderer.heading = function(text, level, raw) {
        let baseId = raw
            .toLowerCase()
            .replace(/[^\u4e00-\u9fa5a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'heading';
        if (usedIds[baseId]) {
            usedIds[baseId]++;
            baseId = baseId + '-' + usedIds[baseId];
        } else {
            usedIds[baseId] = 1;
        }
        return `<h${level} id="${baseId}">${text}</h${level}>`;
    };
    // 图片懒加载：首图 eager+high，后续全 lazy+low，decoding=async
    // 修复长文档多图一次性下载卡顿（如 PARAPARK 设计总纲 21 张 11MB）
    let _imgIdx = 0;
    renderer.image = function(href, title, text) {
        const eager = _imgIdx === 0;
        const loading = eager ? 'eager' : 'lazy';
        const priority = eager ? 'high' : 'low';
        _imgIdx++;
        const safeAlt = (text || '').replace(/"/g, '&quot;');
        const safeTitle = title ? ` title="${String(title).replace(/"/g, '&quot;')}"` : '';
        return `<img src="${href}" alt="${safeAlt}"${safeTitle} loading="${loading}" decoding="async" fetchpriority="${priority}">`;
    };
    marked.use({ renderer });
    
    // 使用marked渲染Markdown
    return marked.parse(md);
}

function initUI() {
    // 首次启动时保存 hero 模板，用于"回首页"而无需刷新
    const contentEl0 = document.getElementById('content');
    if (contentEl0 && !window.__HERO_HTML) {
        window.__HERO_HTML = contentEl0.innerHTML;
    }

    const mainTitle = document.getElementById('mainTitle');
    if (mainTitle) {
        mainTitle.style.cursor = 'pointer';
        mainTitle.title = '返回首页';
        mainTitle.onclick = goHome;
    }
    const headerBrand = document.querySelector('.header-brand');
    if (headerBrand) {
        headerBrand.onclick = goHome;
    }
    
    const drawer = document.getElementById('settingsDrawer');
    const toggle = document.getElementById('settingsToggle');
    const close = document.getElementById('closeSettings');
    const overlay = document.getElementById('settingsOverlay');

    if (toggle) {
        toggle.onclick = (e) => {
            e.stopPropagation();
            drawer.classList.add('open');
        };
    }
    if (close) {
        close.onclick = () => {
            drawer.classList.remove('open');
        };
    }
    if (overlay) {
        overlay.onclick = () => {
            drawer.classList.remove('open');
        };
    }
    
    const menuToggle = document.getElementById('menuToggle');
    const closeSidebar = document.getElementById('closeSidebar');
    const sidebar = document.getElementById('sidebar');

    if (menuToggle) {
        menuToggle.onclick = () => {
            sidebar.classList.add('open');
        };
    }
    if (closeSidebar) {
        closeSidebar.onclick = () => {
            sidebar.classList.remove('open');
        };
    }

    // 桌面端 sidebar 折叠切换（持久化到 localStorage）
    const sidebarToggle = document.getElementById('sidebarToggle');
    const applyCollapsedState = (collapsed) => {
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        if (sidebarToggle) sidebarToggle.classList.toggle('collapsed', collapsed);
        if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    };
    // 初始化：读 localStorage
    try {
        const savedCollapsed = localStorage.getItem('godrise_sidebar_collapsed') === '1';
        if (savedCollapsed && window.innerWidth > 1024) applyCollapsedState(true);
    } catch (e) { /* ignore */ }

    if (sidebarToggle) {
        sidebarToggle.onclick = () => {
            // 移动端：复用为打开侧边栏
            if (window.innerWidth <= 1024) {
                sidebar?.classList.toggle('open');
                return;
            }
            // 桌面端：切换折叠
            const next = !document.body.classList.contains('sidebar-collapsed');
            applyCollapsedState(next);
            try { localStorage.setItem('godrise_sidebar_collapsed', next ? '1' : '0'); } catch (e) {}
        };
    }

    // ── Mobile bottom tabbar ──
    setupMobileTabbar(sidebar);

    // ── v53 Hero 交互：尺度墙 count-up + 动态数据注入 ──
    initHeroV53();
}

/* ============ v53 · Hero 首屏动效 ============
 * - 尺度墙数字 count-up（IntersectionObserver 触发一次）
 * - 从 stats.json 拉取铁律数/名场面数/设定字数动态填充
 * - 不改既有 updateStats 流程，兼容 legacy-stats DOM
 */
function initHeroV53() {
    const hero = document.querySelector('.welcome-hero.v53');
    if (!hero) return;

    const scaleNums = Array.from(hero.querySelectorAll('.scale-num[data-count-target]'));
    const ruleEl = hero.querySelector('#scaleRules');
    const momentEl = hero.querySelector('#scaleMoments');
    const wordsEl = hero.querySelector('#scaleWords');

    const formatWord = (n) => {
        if (n >= 10000) return (n / 10000).toFixed(1) + '万';
        return n.toLocaleString();
    };

    const playCount = (el, target, suffix, dur) => {
        if (!el) return;
        const fmt = (v) => {
            const s = suffix ? `<span class="suffix">${suffix}</span>` : '';
            return `${v}${s}`;
        };
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / (dur || 900));
            const eased = 1 - Math.pow(1 - t, 3);
            const v = Math.round(target * eased);
            el.innerHTML = fmt(v);
            if (t < 1) requestAnimationFrame(step);
            else el.innerHTML = fmt(target);
        };
        requestAnimationFrame(step);
    };

    const playCountCustom = (el, target, format, dur) => {
        if (!el) return;
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / (dur || 1100));
            const eased = 1 - Math.pow(1 - t, 3);
            const v = target * eased;
            el.innerHTML = format(v);
            if (t < 1) requestAnimationFrame(step);
            else el.innerHTML = format(target);
        };
        requestAnimationFrame(step);
    };

    // 拉取 stats.json，用真实数据填充
    let statsPromise = fetch('web/stats.json?v=53', { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);

    const runOnce = () => {
        // 固定尺度先播
        scaleNums.forEach((el, i) => {
            const target = parseInt(el.dataset.countTarget, 10);
            const suffix = el.dataset.countSuffix || '';
            playCount(el, target, suffix, 1000 + i * 80);
        });

        // 动态数据等 stats
        statsPromise.then(stats => {
            if (!stats) return;
            // 铁律数 = itemCount（stats.json 中的 199）
            const ruleCount = stats.itemCount || 199;
            if (ruleEl) playCount(ruleEl, ruleCount, ruleEl.dataset.countSuffix || '条', 1300);

            // 名场面数：统计 files 中 moments/b*_*.md
            let momentCount = 0;
            let settingWordCount = 0;
            const files = stats.files || {};
            for (const [path, wc] of Object.entries(files)) {
                if (/^moments\/b\d+_.+\.md$/.test(path)) momentCount++;
                if (!path.startsWith('_staging/manuscript/')) settingWordCount += wc;
            }
            if (momentEl) playCount(momentEl, momentCount, momentEl.dataset.countSuffix || '场', 1400);
            if (wordsEl) {
                const target = (stats.totals && stats.totals.settingWords) || settingWordCount;
                playCountCustom(wordsEl, target, (v) => {
                    const n = Math.round(v);
                    return `${formatWord(n)}`;
                }, 1500);
            }
        });
    };

    // IntersectionObserver：进入视口才播
    if ('IntersectionObserver' in window) {
        let played = false;
        const io = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting && !played) {
                    played = true;
                    runOnce();
                    io.disconnect();
                }
            });
        }, { threshold: 0.15 });
        const scaleWall = hero.querySelector('.hero-scale');
        if (scaleWall) io.observe(scaleWall);
        else runOnce();
    } else {
        runOnce();
    }
}


function setupMobileTabbar(sidebar) {
    const tabbar = document.getElementById('mobileTabbar');
    if (!tabbar) return;

    const mobileSearchBar = document.getElementById('mobileSearchBar');
    const mobileSearchInput = document.getElementById('mobileSearchInput');
    const mobileSearchGo = document.getElementById('mobileSearchGo');
    const mobileSearchClose = document.getElementById('mobileSearchClose');

    function closeSidebar() {
        sidebar?.classList.remove('open');
    }
    function closeAll(except) {
        if (except !== 'sidebar') closeSidebar();
        if (except !== 'search') mobileSearchBar?.classList.remove('open');
        if (except !== 'toc' && typeof closeRightPanel === 'function') closeRightPanel();
        if (except !== 'settings') document.getElementById('settingsDrawer')?.classList.remove('open');
        tabbar.querySelectorAll('.tabbar-item').forEach(t => t.classList.remove('active'));
    }

    document.getElementById('tabSidebar')?.addEventListener('click', () => {
        const open = sidebar?.classList.contains('open');
        closeAll('sidebar');
        if (open) closeSidebar();
        else { sidebar?.classList.add('open'); document.getElementById('tabSidebar')?.classList.add('active'); }
    });

    document.getElementById('tabSearch')?.addEventListener('click', () => {
        const open = mobileSearchBar?.classList.contains('open');
        closeAll('search');
        if (open) { mobileSearchBar?.classList.remove('open'); }
        else {
            mobileSearchBar?.classList.add('open');
            document.getElementById('tabSearch')?.classList.add('active');
            setTimeout(() => mobileSearchInput?.focus(), 150);
        }
    });

    // Mobile search → reuse performSearch（移动端默认全站，placeholder 也写"搜索全文"）
    function doMobileSearch() {
        const q = mobileSearchInput?.value.trim();
        if (q && typeof performSearch === 'function') {
            performSearch(q, 'site');
            mobileSearchBar?.classList.remove('open');
            document.getElementById('tabSearch')?.classList.remove('active');
        }
    }
    mobileSearchGo?.addEventListener('click', doMobileSearch);
    mobileSearchInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') doMobileSearch(); });
    mobileSearchClose?.addEventListener('click', () => {
        mobileSearchBar?.classList.remove('open');
        document.getElementById('tabSearch')?.classList.remove('active');
    });

    document.getElementById('tabToc')?.addEventListener('click', () => {
        const panel = document.getElementById('rightPanel');
        const open = panel?.classList.contains('open');
        closeAll('toc');
        if (open) { if (typeof closeRightPanel === 'function') closeRightPanel(); }
        else { if (typeof openRightPanel === 'function') openRightPanel(); document.getElementById('tabToc')?.classList.add('active'); }
    });

    document.getElementById('tabInteraction')?.addEventListener('click', () => {
        closeAll();
        if (typeof showInteractionPage === 'function') showInteractionPage();
        window.location.hash = 'interaction';
    });

    document.getElementById('tabSettings')?.addEventListener('click', () => {
        const drawer = document.getElementById('settingsDrawer');
        const open = drawer?.classList.contains('open');
        closeAll('settings');
        if (open) drawer?.classList.remove('open');
        else { drawer?.classList.add('open'); document.getElementById('tabSettings')?.classList.add('active'); }
    });
}

function initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    
    const btn = document.getElementById('themeToggle');
    const updateBtn = (theme) => {
        const icon = btn?.querySelector('.theme-icon');
        const text = btn?.querySelector('.theme-text');
        if (theme === 'dark') {
            if (icon) icon.textContent = '☀️';
            if (text) text.textContent = '切换为亮色模式';
        } else {
            if (icon) icon.textContent = '🌙';
            if (text) text.textContent = '切换为暗色模式';
        }
    };
    
    updateBtn(saved);
    
    if (btn) {
        btn.onclick = () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            updateBtn(next);
        };
    }
}

function goHome(fromHistory) {
    const contentArea = document.getElementById('content');
    if (!contentArea || !window.__HERO_HTML) {
        // 兜底：没拿到模板就走老办法
        history.replaceState(null, '', location.pathname + location.search);
        location.reload();
        return;
    }
    // 非 history 恢复（即用户主动点首页）时 push 新历史条目，让浏览器后退回到阅读位置
    if (!fromHistory) {
        const hasHash = location.hash && location.hash.length > 1;
        if (hasHash) {
            // 先 push 无 hash 的 URL（触发 hashchange，但它会检测已是 hero 不重复渲染）
            history.pushState({ home: true }, '', location.pathname + location.search);
        }
    }
    contentArea.innerHTML = window.__HERO_HTML;
    contentArea.style.opacity = '1';
    // 关闭搜索面板、回声抽屉等
    document.getElementById('searchResultsPanel')?.classList.remove('show');
    document.getElementById('sidebar')?.classList.remove('open');
    // 重新绑定 hero 内的 entry 卡片 + 重新动画统计
    document.querySelectorAll('.entry-card[data-nav-section]').forEach(card => {
        card.onclick = (e) => {
            e.preventDefault();
            const section = card.dataset.navSection;
            const link = document.querySelector(`.nav-link[data-section="${section}"]`);
            if (link) link.click();
            else scrollToSectionAndLoad(section);
        };
    });
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    if (typeof updateStats === 'function') {
        updateStats().catch(() => {});
    }
    // v53: 重新绑定尺度墙 count-up
    if (typeof initHeroV53 === 'function') {
        try { initHeroV53(); } catch (e) {}
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            const section = link.dataset.section;

            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            if (link.id === 'interactionBtn') {
                showInteractionPage();
            } else {
                scrollToSectionAndLoad(section);
            }
        };
    });

    // 首页 hero 快速入口卡片
    document.querySelectorAll('.entry-card[data-nav-section]').forEach(card => {
        card.onclick = (e) => {
            e.preventDefault();
            const section = card.dataset.navSection;
            const link = document.querySelector(`.nav-link[data-section="${section}"]`);
            if (link) link.click();
            else scrollToSectionAndLoad(section);
        };
    });
}

function scrollToSectionAndLoad(section) {
    const nav = document.getElementById('chapterNav');
    const sections = nav.querySelectorAll('.encyclopedia-section');

    // 按 section.type 精确匹配：world-building 有多个子区（圣旨/宇宙/力量/AI/山海…），
    // 命中第一个，并展开同类型所有兄弟区，避免"点了没反应"
    const typeMatch = [];
    sections.forEach((sec) => {
        if (sec.dataset.sectionType === section) typeMatch.push(sec);
    });

    if (typeMatch.length === 0) {
        // 兜底：按 section-title 文本模糊匹配
        sections.forEach((sec) => {
            const title = sec.querySelector('.section-title');
            if (!title) return;
            const text = title.textContent.toLowerCase();
            if (text.includes(section)) typeMatch.push(sec);
        });
    }

    if (typeMatch.length === 0) return;

    // 展开全部同类型 section，滚到第一个
    typeMatch.forEach((sec, idx) => {
        const title = sec.querySelector('.section-title');
        const content = sec.querySelector('.section-content');
        if (!title || !content) return;
        title.classList.add('active');
        content.classList.add('open');
        content.style.maxHeight = content.scrollHeight + 'px';
    });

    if (window.innerWidth <= 1024) {
        document.getElementById('sidebar').classList.add('open');
    }

    const first = typeMatch[0];
    const firstTitle = first.querySelector('.section-title');
    const firstContent = first.querySelector('.section-content');

    setTimeout(() => {
        firstTitle?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    setTimeout(() => {
        const firstItem = firstContent?.querySelector('.chapter-item');
        if (firstItem) firstItem.click();
    }, 300);
}

async function showInteractionPage() {
    trackPageReadTime();
    
    window.location.hash = 'interaction';
    
    const content = document.getElementById('content');
    content.style.opacity = '0';
    
    let settingWordCount = state.cachedSettingWords || 0;
    let chapterWordCount = state.cachedChapterWords || 0;
    
    if (!settingWordCount && !chapterWordCount) {
        state.allItems.forEach(item => {
            const wc = item.wordCount || 0;
            if (item.type === 'chapter') chapterWordCount += wc;
            else settingWordCount += wc;
        });
    }
    
    const totalWords = settingWordCount + chapterWordCount;
    const formatCount = (n) => n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString();
    
    const totalMinutes = Math.floor(state.totalReadTime / 60);
    const chapters = state.allItems.filter(i => i.type === 'chapter');
    const totalPages = state.allItems.length;
    const totalCharacters = state.encyclopedia?.sections?.find(s => s.type === 'characters')?.items?.length || 0;
    
    // 统计各页面访问数据
    const pageVisitData = [];
    state.allItems.forEach(item => {
        const pageKey = `${item.sIdx}-${item.type === 'chapter' ? item.bIdx : item.iIdx}-${item.type === 'chapter' ? item.cIdx : -1}`;
        const viewCount = state.pageReadTimes[pageKey] ? 1 : 0;
        const readTime = Math.floor((state.pageReadTimes[pageKey] || 0) / 60);
        if (viewCount > 0 || readTime > 0) {
            pageVisitData.push({
                title: item.type === 'chapter' ? `${item.bookTitle} · ${item.title}` : `${item.sectionTitle} · ${item.title}`,
                visits: viewCount,
                duration: readTime
            });
        }
    });
    
    content.innerHTML = `
        <div class="interaction-page" style="max-width: 900px; margin: 0 auto;">
            <h1 style="text-align: center; color: var(--copper); margin-bottom: 2rem; font-size: 1.75rem;">📖 读者互动中心</h1>
            
            <!-- 核心统计（6列网格） -->
            <div class="stats-grid-6">
                <div class="stat-card accent">
                    <div class="stat-val">${formatCount(totalWords)}</div>
                    <div class="stat-label">总字数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${formatCount(settingWordCount)}</div>
                    <div class="stat-label">设定字数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${formatCount(chapterWordCount)}</div>
                    <div class="stat-label">正文字数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${totalMinutes}</div>
                    <div class="stat-label">阅读(分)</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${state.viewCount}</div>
                    <div class="stat-label">访问数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${getTotalCommentCount()}</div>
                    <div class="stat-label">评论数</div>
                </div>
            </div>
            
            <!-- 次要统计 -->
            <div class="stats-row">
                <span>📄 页面：${totalPages}</span>
                <span>📖 章节：${chapters.length}</span>
                <span>👥 角色：${totalCharacters}</span>
            </div>
                
                <!-- 各页面访问统计（可折叠） -->
                <div class="collapsible-section">
                    <div class="collapsible-header" onclick="toggleCollapsible(this)">
                        <h4>📊 各页面访问统计</h4>
                        <span class="collapsible-toggle">▼</span>
                    </div>
                    <div class="collapsible-content">
                        <div class="collapsible-body">
                            <div class="page-stats-list">
                                ${pageVisitData.length === 0 ? '<p style="text-align: center; color: var(--text-muted); font-size: 0.875rem;">暂无访问记录</p>' : 
                                pageVisitData.map(p => `
                                    <div class="page-stat-item">
                                        <span class="page-stat-title">${p.title}</span>
                                        <span class="page-stat-data">${p.duration}分钟</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- 作者说明 -->
                <div style="background: var(--bg-sidebar); padding: 1.75rem; border-radius: 12px; border-left: 4px solid var(--copper); margin-bottom: 1.5rem; line-height: 1.8;">
                    <h3 style="font-family: var(--font-serif); margin-bottom: 0.875rem; font-size: 0.9375rem;">✍️ 作者致读者</h3>
                    <p style="color: var(--text-secondary); font-size: 0.875rem;">《神临山海》是一个宏大的硬科幻计划。在这个宇宙中，每一个物理常数的变化都预示着文明的兴衰。感谢您的关注与支持。</p>
                </div>
                
                <!-- 留言板（可折叠） -->
                <div class="collapsible-section">
                    <div class="collapsible-header" onclick="toggleCollapsible(this)">
                        <h4>💭 读者留言板</h4>
                        <span class="collapsible-toggle">▼</span>
                    </div>
                    <div class="collapsible-content">
                        <div class="collapsible-body">
                            <textarea id="comInput" placeholder="分享您的想法..." style="width: 100%; height: 100px; padding: 1rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-paper); color: var(--text-primary); resize: none; font-family: var(--font-sans); margin-bottom: 1rem; font-size: 0.875rem;"></textarea>
                            <button onclick="submitComment()" style="padding: 0.5rem 1.5rem; background: var(--copper); color: white; border: none; border-radius: 20px; cursor: pointer; font-weight: 500; font-size: 0.875rem;">发布评论</button>
                            <div id="comList" style="margin-top: 1.5rem;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        content.style.opacity = '1';

        renderComments();

        syncCommentsFromCloud().then(() => renderComments());
}

window.toggleCollapsible = (header) => {
    const content = header.nextElementSibling;
    const isActive = header.classList.toggle('active');
    if (isActive) {
        content.style.maxHeight = content.scrollHeight + 'px';
        content.classList.add('open');
    } else {
        content.style.maxHeight = '0';
        content.classList.remove('open');
    }
};

window.submitComment = async () => {
    const input = document.getElementById('comInput');
    const val = input?.value.trim();
    if (!val) return;

    const doSubmit = () => {
        const comment = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            user: state.user ? state.user.nickname : '匿名读者',
            email: state.user ? state.user.email : 'anon',
            text: val,
            time: new Date().toLocaleString(),
            replies: []
        };
        state.comments.unshift(comment);
        localStorage.setItem('comments', JSON.stringify(state.comments));
        input.value = '';
        renderComments();
        apiCall('/api/comments', 'POST', { action: 'add', comment }).then(r => {
            if (r && r.comments) { state.comments = r.comments; localStorage.setItem('comments', JSON.stringify(r.comments)); renderComments(); }
        });
    };

    if (!state.user) {
        showNicknamePrompt(doSubmit);
    } else {
        doSubmit();
    }
};

function renderComments() {
    const list = document.getElementById('comList');
    if (!list) return;

    if (state.comments.length === 0) {
        list.innerHTML = '<p style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.875rem;">暂无评论，来说点什么吧</p>';
    } else {
        list.innerHTML = state.comments.map(c => renderCommentHTML(c, 0)).join('');
        list.querySelectorAll('.reply-btn').forEach(btn => {
            btn.onclick = () => toggleReplyBox(btn.dataset.id);
        });
        list.querySelectorAll('.reply-submit').forEach(btn => {
            btn.onclick = () => submitReply(btn.dataset.id);
        });
        list.querySelectorAll('.delete-comment-btn').forEach(btn => {
            btn.onclick = () => deleteCommentById(btn.dataset.id);
        });
    }

    const collapsible = list.closest('.collapsible-content');
    if (collapsible && collapsible.classList.contains('open')) {
        collapsible.style.maxHeight = 'none';
        collapsible.style.overflow = 'visible';
    }
}

function renderCommentHTML(c, depth) {
    const indent = Math.min(depth, 3) * 1.25;
    const avatar = (c.user || '?').charAt(0).toUpperCase();
    const isOwn = state.user && c.email === state.user.email;
    const repliesHTML = (c.replies || []).map(r => renderCommentHTML(r, depth + 1)).join('');
    return `
    <div class="comment-node" style="margin-left:${indent}rem;${depth > 0 ? 'border-left:2px solid var(--border);padding-left:0.75rem;' : ''}">
        <div class="comment-card">
            <div class="comment-header">
                <span class="comment-avatar">${avatar}</span>
                <span class="comment-user">${c.user || '匿名'}</span>
                <span class="comment-time">${c.time}</span>
                ${isOwn ? `<button class="delete-comment-btn" data-id="${c.id}" title="删除">✕</button>` : ''}
            </div>
            ${c.quote ? `<div class="comment-quote">"${c.quote.length > 60 ? c.quote.substring(0, 60) + '…' : c.quote}"</div>` : ''}
            <div class="comment-body">${escapeHTML(c.text)}</div>
            <div class="comment-actions">
                <button class="reply-btn" data-id="${c.id}">回复</button>
            </div>
            <div class="reply-box" id="reply-box-${c.id}" style="display:none;">
                <textarea class="reply-input" id="reply-input-${c.id}" placeholder="回复 ${c.user}…" rows="2"></textarea>
                <button class="reply-submit" data-id="${c.id}">发送</button>
            </div>
        </div>
        ${repliesHTML}
    </div>`;
}

function escapeHTML(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function toggleReplyBox(commentId) {
    const box = document.getElementById('reply-box-' + commentId);
    if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function submitReply(parentId) {
    const input = document.getElementById('reply-input-' + parentId);
    const val = input?.value.trim();
    if (!val) return;

    const doReply = () => {
        const reply = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            user: state.user ? state.user.nickname : '匿名读者',
            email: state.user ? state.user.email : 'anon',
            text: val,
            time: new Date().toLocaleString(),
            replies: []
        };
        function addReplyLocal(comments) {
            for (const c of comments) {
                if (c.id === parentId) { c.replies = c.replies || []; c.replies.push(reply); return true; }
                if (c.replies && addReplyLocal(c.replies)) return true;
            }
            return false;
        }
        addReplyLocal(state.comments);
        localStorage.setItem('comments', JSON.stringify(state.comments));
        renderComments();
        apiCall('/api/comments', 'POST', { action: 'reply', parentId, reply }).then(r => {
            if (r && r.comments) { state.comments = r.comments; localStorage.setItem('comments', JSON.stringify(r.comments)); renderComments(); }
        });
    };

    if (!state.user) {
        showNicknamePrompt(doReply);
    } else {
        doReply();
    }
}

async function deleteCommentById(id) {
    function remove(arr) {
        const idx = arr.findIndex(c => c.id === id);
        if (idx >= 0) { arr.splice(idx, 1); return true; }
        for (const c of arr) { if (c.replies && remove(c.replies)) return true; }
        return false;
    }
    if (confirm('确定删除这条评论？')) {
        remove(state.comments);
        localStorage.setItem('comments', JSON.stringify(state.comments));
        renderComments();
        const r = await apiCall('/api/comments', 'POST', { action: 'delete', id });
        if (r && r.comments) { state.comments = r.comments; localStorage.setItem('comments', JSON.stringify(r.comments)); renderComments(); }
    }
}

// deleteComment replaced by deleteCommentById above

function setupSearch() {
    const searchBtn = document.getElementById('searchButton');
    const searchInput = document.getElementById('searchInput');
    const closeSearch = document.getElementById('closeSearch');

    // v56: 智能 scope 选择——首页/未打开文档默认全站；否则按钮=本页，Enter=全站
    const pickInitialScope = (source) => {
        if (!state.currentDocPath) return 'site';
        if (source === 'enter') return 'site';
        return 'page';
    };

    if (searchBtn) {
        searchBtn.onclick = () => {
            const query = searchInput?.value.trim();
            if (query) {
                performSearch(query, pickInitialScope('button'));
            } else {
                // 空查询：打开面板并提示
                performSearch('', pickInitialScope('button'));
                searchInput?.focus();
            }
        };
    }

    if (searchInput) {
        // 使用 keydown 覆盖更多输入法情况；保留 Enter 触发全站
        searchInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                const query = searchInput.value.trim();
                if (query) {
                    performSearch(query, pickInitialScope('enter'));
                }
            } else if (e.key === 'Escape') {
                document.getElementById('searchResultsPanel')?.classList.remove('show');
                searchInput.blur();
            }
        };
    }

    if (closeSearch) {
        closeSearch.onclick = () => {
            document.getElementById('searchResultsPanel')?.classList.remove('show');
            clearSearchHighlight();
        };
    }

    // v56 修复：tab 点击切换 scope（之前完全没有绑定，点了没反应）
    document.querySelectorAll('.search-tab').forEach(tab => {
        tab.onclick = () => {
            const scope = tab.dataset.searchScope;
            if (!scope) return;
            const q = (searchInput?.value || _searchState.query || '').trim();
            if (!q) {
                // 无查询词时只更新视觉 + 记住用户选择
                _searchState.scope = scope;
                document.querySelectorAll('.search-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.searchScope === scope);
                });
                return;
            }
            performSearch(q, scope);
        };
    });

    // v56 修复：只有点击搜索面板外的 sidebar/内容区才关闭；面板自身点击不再冒泡关闭
    const panel = document.getElementById('searchResultsPanel');
    panel?.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('sidebar')?.addEventListener('click', () => {
        document.getElementById('searchResultsPanel')?.classList.remove('show');
    });
    // 主内容区点击关闭面板（面板已 stopPropagation，不影响面板内操作）
    document.getElementById('readerContent')?.addEventListener('click', () => {
        document.getElementById('searchResultsPanel')?.classList.remove('show');
    });
}

// Search content cache — persists across searches in the same session
const _searchCache = {};

// v52 流式搜索状态 —— seq 用于取消过期请求，scope 记忆用户选择
const _searchState = { seq: 0, scope: 'page', query: '' };

function _escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function _escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function _findMatches(text, lowerQuery, rawQuery, max) {
    const matches = [];
    const lowerText = text.toLowerCase();
    let idx = 0, pos;
    const limit = max || 80;
    while ((pos = lowerText.indexOf(lowerQuery, idx)) !== -1 && matches.length < limit) {
        const start = Math.max(0, pos - 50);
        const end = Math.min(text.length, pos + rawQuery.length + 50);
        const snippet = text.substring(start, end);
        const lineNum = text.substring(0, pos).split('\n').length;
        matches.push({ snippet, position: pos, lineNum });
        idx = pos + rawQuery.length;
    }
    return matches;
}

function _renderMatchGroup(list, item, matches, query, gIdx) {
    const displayTitle = item.type === 'chapter'
        ? `${item.bookTitle || ''} · ${item.title}`
        : `${item.sectionTitle || ''} · ${item.title}`;
    const re = new RegExp(_escapeRegex(query), 'gi');
    const matchesHtml = matches.map((m) => {
        // v56 修复：先 escape HTML 避免片段里的 < & 等破坏渲染，再高亮
        const safeSnippet = _escapeHTML(m.snippet);
        // 用同样的 escape 后的 query 做替换，避免 query 含特殊字符时错位
        const safeQuery = _escapeHTML(query);
        const reSafe = new RegExp(_escapeRegex(safeQuery), 'gi');
        const snippet = safeSnippet.replace(reSafe, (match) => `<mark>${match}</mark>`);
        return `<div class="search-match-item"
             data-sidx="${item.sIdx}"
             data-type="${item.type}"
             data-idx1="${item.type === 'chapter' ? item.bIdx : item.iIdx}"
             data-idx2="${item.type === 'chapter' ? item.cIdx : -1}"
             data-position="${m.position}"
             data-query="${encodeURIComponent(query)}">
            <span class="match-line">L${m.lineNum}</span>
            <span class="match-snippet">…${snippet}…</span>
        </div>`;
    }).join('');

    const groupEl = document.createElement('div');
    groupEl.className = 'search-result-group';
    groupEl.innerHTML = `
        <div class="result-group-header" data-gidx="${gIdx}">
            <span class="group-toggle">▼</span>
            <span class="group-title">${displayTitle}</span>
            <span class="group-count">${matches.length}</span>
        </div>
        <div class="result-group-matches">${matchesHtml}</div>
    `;
    list.appendChild(groupEl);

    const header = groupEl.querySelector('.result-group-header');
    const matchesEl = groupEl.querySelector('.result-group-matches');
    const toggle = groupEl.querySelector('.group-toggle');
    header.onclick = () => {
        const collapsed = matchesEl.style.display === 'none';
        matchesEl.style.display = collapsed ? 'block' : 'none';
        toggle.textContent = collapsed ? '▼' : '▶';
    };
    groupEl.querySelectorAll('.search-match-item').forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            const sIdx = parseInt(el.dataset.sidx);
            const type = el.dataset.type;
            const idx1 = parseInt(el.dataset.idx1);
            const idx2 = parseInt(el.dataset.idx2);
            const position = parseInt(el.dataset.position);
            const searchQuery = decodeURIComponent(el.dataset.query);
            state.searchHighlight = { query: searchQuery, position };
            trackPageReadTime();
            loadItem(sIdx, idx1, idx2, type);
            document.getElementById('searchResultsPanel')?.classList.remove('show');
        };
    });
}

async function performSearch(query, scope) {
    const panel = document.getElementById('searchResultsPanel');
    const list = document.getElementById('searchResultsList');
    const status = document.getElementById('searchStreamStatus');
    if (!panel || !list) return;

    scope = scope || _searchState.scope || 'page';
    _searchState.scope = scope;
    _searchState.query = query;
    const mySeq = ++_searchState.seq;

    // 同步 tab 视觉
    document.querySelectorAll('.search-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.searchScope === scope);
    });

    panel.classList.add('show');
    list.innerHTML = '';
    if (status) { status.textContent = ''; status.classList.remove('done'); }

    if (!query || !query.trim()) {
        // v56：空查询时仍同步 tab 视觉，并给出明确提示
        list.innerHTML = `<div class="no-results">输入关键词后按 Enter（${scope === 'site' ? '全站' : '本页'}）</div>`;
        return;
    }
    const lowerQuery = query.toLowerCase();

    // ── 本页搜索（默认，极快）──
    if (scope === 'page') {
        const curPath = state.currentDocPath ? resolvePath(state.currentDocPath) : null;
        const curItem = curPath ? state.allItems.find(i => resolvePath(i.file) === curPath) : null;
        if (!curItem) {
            // v56 修复：首页/未打开文档时，本页搜索无意义——自动切到全站
            if (status) status.textContent = '首页无"本页"可搜，自动使用全站搜索';
            return performSearch(query, 'site');
        }
        let text = state._docCache[curPath] || _searchCache[curPath];
        if (!text) {
            if (status) status.textContent = '加载本页…';
            try { text = await fetchDoc(curPath); _searchCache[curPath] = text; }
            catch (e) {
                list.innerHTML = '<div class="no-results">加载本页失败</div>'; return;
            }
        }
        if (mySeq !== _searchState.seq) return;
        const matches = _findMatches(text, lowerQuery, query, 200);
        if (matches.length === 0) {
            list.innerHTML = '<div class="no-results">本页无匹配 · <a class="switch-scope" data-switch="site">切到全站搜索</a></div>';
            _wireScopeSwitch(query);
            if (status) status.textContent = '0 / 本页';
            return;
        }
        _renderMatchGroup(list, curItem, matches, query, 0);
        const hint = document.createElement('div');
        hint.className = 'search-scope-hint';
        hint.innerHTML = `<a class="switch-scope" data-switch="site">→ 全站继续搜索 "${query.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])}"</a>`;
        list.appendChild(hint);
        _wireScopeSwitch(query);
        if (status) { status.textContent = `本页 ${matches.length} 处`; status.classList.add('done'); }
        return;
    }

    // ── 全站流式搜索 ──
    // 优先扫已缓存的文档，让用户"秒出第一批"
    const total = state.allItems.length;
    const cachedFirst = [];
    const rest = [];
    for (const it of state.allItems) {
        if (!it.file) continue;
        const p = resolvePath(it.file);
        (state._docCache[p] || _searchCache[p]) ? cachedFirst.push(it) : rest.push(it);
    }
    const ordered = [...cachedFirst, ...rest];

    let scanned = 0, foundDocs = 0, hits = 0;
    const updateStatus = () => {
        if (!status) return;
        status.textContent = `扫描 ${scanned}/${total} · 命中 ${foundDocs} 文档 · ${hits} 处`;
    };
    updateStatus();

    const BATCH = 6;
    for (let i = 0; i < ordered.length; i += BATCH) {
        if (mySeq !== _searchState.seq) return; // 被新查询取代
        const batch = ordered.slice(i, i + BATCH);
        await Promise.all(batch.map(async (item) => {
            if (mySeq !== _searchState.seq) return;
            const p = resolvePath(item.file);
            let text = state._docCache[p] || _searchCache[p];
            if (!text) {
                try { text = await fetchDoc(p); _searchCache[p] = text; }
                catch (e) { scanned++; return; }
            }
            if (mySeq !== _searchState.seq) return;
            const matches = _findMatches(text, lowerQuery, query, 50);
            scanned++;
            if (matches.length > 0) {
                foundDocs++;
                hits += matches.length;
                _renderMatchGroup(list, item, matches, query, foundDocs - 1);
            }
            updateStatus();
        }));
    }
    if (mySeq !== _searchState.seq) return;
    if (foundDocs === 0) {
        list.innerHTML = '<div class="no-results">全站无匹配</div>';
    }
    if (status) { status.textContent = `共 ${foundDocs} 文档 / ${hits} 处`; status.classList.add('done'); }
}

function _wireScopeSwitch(query) {
    document.querySelectorAll('.switch-scope').forEach(a => {
        a.onclick = (e) => {
            e.preventDefault();
            const next = a.dataset.switch || 'site';
            performSearch(query, next);
        };
    });
}

/**
 * 带动画的数字递增：从 0 平滑滚到 target
 */
function animateCount(el, target, formatter, durationMs) {
    if (!el) return;
    const start = performance.now();
    const dur = durationMs || 900;
    const from = 0;
    const step = (now) => {
        const t = Math.min(1, (now - start) / dur);
        // easeOutCubic
        const eased = 1 - Math.pow(1 - t, 3);
        const v = Math.round(from + (target - from) * eased);
        el.textContent = formatter ? formatter(v) : v;
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = formatter ? formatter(target) : target;
    };
    requestAnimationFrame(step);
}

async function updateStats() {
    const totalEl = document.getElementById('totalChapters');
    const wordsEl = document.getElementById('totalWords');
    const settingWordsEl = document.getElementById('settingWords');
    const chapterWordsEl = document.getElementById('chapterWords');

    const formatCount = (n) => n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString();

    // Step 1: 先秒显总数（allItems 长度是已知的）
    if (totalEl) animateCount(totalEl, state.allItems.length, null, 600);

    // Step 2: 优先从预计算的 stats.json 取数 —— 1 个 fetch 代替 ~200 个
    try {
        const res = await fetch('web/stats.json?v=53', { cache: 'force-cache' });
        if (res.ok) {
            const stats = await res.json();
            // 合并：stats.files 里没有的文件，走 live fallback（理论上应对得上）
            const files = stats.files || {};
            let chapterWordCount = 0;
            let settingWordCount = 0;
            const missing = [];
            for (const item of state.allItems) {
                if (!item.file) continue;
                if (item.file in files) {
                    const wc = files[item.file];
                    item.wordCount = wc;
                    if (item.type === 'chapter') chapterWordCount += wc;
                    else settingWordCount += wc;
                } else {
                    missing.push(item);
                }
            }
            // 渲染（带滚动动画）
            state.cachedChapterWords = chapterWordCount;
            state.cachedSettingWords = settingWordCount;
            if (chapterWordsEl) animateCount(chapterWordsEl, chapterWordCount, formatCount, 1200);
            if (settingWordsEl) animateCount(settingWordsEl, settingWordCount, formatCount, 1200);
            if (wordsEl) animateCount(wordsEl, chapterWordCount + settingWordCount, formatCount, 1400);

            console.log(`📊 统计（缓存命中 ${stats.generatedAt || ''}）：设定 ${formatCount(settingWordCount)} / 正文 ${formatCount(chapterWordCount)} / 总 ${formatCount(chapterWordCount + settingWordCount)}${missing.length ? ' / 待补 ' + missing.length : ''}`);

            // 后台补齐缺失项（不阻塞）
            if (missing.length) updateStatsFallback(missing, true);
            return;
        }
    } catch (e) {
        console.warn('stats.json 读取失败，回退到 live fetch：', e);
    }

    // Step 3: stats.json 不可用时，live fetch + 限流 8 并发
    await updateStatsFallback(state.allItems.filter(i => i.file), false);
}

async function updateStatsFallback(items, incremental) {
    const chapterWordsEl = document.getElementById('chapterWords');
    const settingWordsEl = document.getElementById('settingWords');
    const wordsEl = document.getElementById('totalWords');
    const formatCount = (n) => n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString();

    let chapterWordCount = incremental ? state.cachedChapterWords : 0;
    let settingWordCount = incremental ? state.cachedSettingWords : 0;

    const CONCURRENCY = 8;
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const it = items[i++];
            try {
                const text = await fetchDoc(resolvePath(it.file));
                const clean = text.replace(/^#+\s.*$/gm, '').replace(/[#*_`\[\]()>|\-\n\r\s]/g, '');
                const wc = clean.length;
                it.wordCount = wc;
                if (it.type === 'chapter') chapterWordCount += wc;
                else settingWordCount += wc;
            } catch (e) { /* 静默 */ }
        }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker);
    await Promise.all(workers);

    state.cachedChapterWords = chapterWordCount;
    state.cachedSettingWords = settingWordCount;
    if (chapterWordsEl) chapterWordsEl.textContent = formatCount(chapterWordCount);
    if (settingWordsEl) settingWordsEl.textContent = formatCount(settingWordCount);
    if (wordsEl) wordsEl.textContent = formatCount(chapterWordCount + settingWordCount);
    console.log(`📊 统计（live fetch）：设定 ${formatCount(settingWordCount)} / 正文 ${formatCount(chapterWordCount)}`);
}

function initProgressTracker() {
    const container = document.getElementById('readerContent');
    const bar = document.getElementById('readingProgressBar');
    if (container && bar) {
        container.onscroll = () => {
            const p = (container.scrollTop / (container.scrollHeight - container.clientHeight)) * 100;
            bar.style.width = Math.max(0, Math.min(100, p)) + '%';
        };
    }
}

function updateActiveNavItem() {
    document.querySelectorAll('.chapter-item').forEach(el => el.classList.remove('active'));
    
    if (!state.currentItem) return;
    
    const { sIdx, idx1, idx2, type } = state.currentItem;
    
    document.querySelectorAll('.chapter-item').forEach(el => {
        const elSIdx = parseInt(el.dataset.sIdx);
        const elIdx1 = parseInt(el.dataset.idx1);
        const elIdx2 = parseInt(el.dataset.idx2);
        
        if (elSIdx === sIdx && elIdx1 === idx1 && elIdx2 === idx2) {
            el.classList.add('active');
            // 确保活动项可见（滚动到视图中）
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    });
}

/**
 * 展开目录到当前项
 */
function expandNavToCurrentItem() {
    if (!state.currentItem) return;
    
    const { sIdx } = state.currentItem;
    
    // 找到对应的section并展开
    document.querySelectorAll('.nav-section').forEach((section, index) => {
        if (index === sIdx) {
            section.classList.add('expanded');
            const content = section.querySelector('.section-content');
            if (content) content.style.display = 'block';
        }
    });
    
    // 触发活动项更新
    updateActiveNavItem();
}

function navigateChapter(direction) {
    if (!state.currentItem) return;
    
    // 清除搜索高亮和关键词
    clearSearchHighlight();
    state.searchHighlight = '';
    
    const idx = state.allItems.findIndex(i => 
        i.sIdx === state.currentItem.sIdx && 
        (state.currentItem.type === 'chapter' ? 
            (i.bIdx === state.currentItem.idx1 && i.cIdx === state.currentItem.idx2) : 
            i.iIdx === state.currentItem.idx1)
    );
    
    const targetIdx = idx + direction;
    if (targetIdx >= 0 && targetIdx < state.allItems.length) {
        const item = state.allItems[targetIdx];
        trackPageReadTime();
        loadItem(
            item.sIdx,
            item.type === 'chapter' ? item.bIdx : item.iIdx,
            item.type === 'chapter' ? item.cIdx : -1,
            item.type
        );
    }
}

/**
 * 设置内部链接拦截
 * 支持：
 * 1. .md文件链接 -> 自动加载文档
 * 2. #锚点链接 -> 滚动到指定位置
 * 3. .md#锚点 -> 加载文档并滚动到锚点
 */
function setupInternalLinks() {
    const contentArea = document.getElementById('content');
    if (!contentArea) return;
    
    contentArea.querySelectorAll('a').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        // 外部链接，保持默认行为
        if (href.startsWith('http://') || href.startsWith('https://')) {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
            return;
        }
        
        // 内部链接，拦截处理
        link.addEventListener('click', (e) => {
            e.preventDefault();
            handleInternalLink(href);
        });
    });
}

/**
 * 处理内部链接
 * @param {string} href - 链接地址（可能包含.md和#锚点）
 */
function handleInternalLink(href) {
    console.log('🔗 点击内部链接:', href);
    
    // 清除搜索高亮和关键词
    clearSearchHighlight();
    state.searchHighlight = '';
    
    // 解析链接：分离文件路径和锚点
    let targetFile = '';
    let anchor = '';
    
    if (href.includes('#')) {
        const parts = href.split('#');
        targetFile = parts[0];
        anchor = parts[1];
    } else {
        targetFile = href;
    }
    
    // 纯锚点（当前页面内跳转）
    if (!targetFile && anchor) {
        scrollToAnchor(anchor);
        return;
    }
    
    // 解析目标文件路径
    if (targetFile.endsWith('.md')) {
        // 相对路径处理
        const currentDir = state.currentDocPath ? state.currentDocPath.substring(0, state.currentDocPath.lastIndexOf('/')) : '';
        let resolvedPath = targetFile;
        
        // 如果是相对路径（./或../），需要解析
        if (targetFile.startsWith('./')) {
            resolvedPath = currentDir + '/' + targetFile.substring(2);
        } else if (targetFile.startsWith('../')) {
            const upLevels = (targetFile.match(/\.\.\//g) || []).length;
            let pathParts = currentDir.split('/');
            pathParts = pathParts.slice(0, pathParts.length - upLevels);
            const remainingPath = targetFile.replace(/\.\.\//g, '');
            resolvedPath = pathParts.join('/') + '/' + remainingPath;
        }
        
        console.log('📂 解析路径:', {
            原始: targetFile,
            当前目录: currentDir,
            解析后: resolvedPath
        });
        
        // 在allItems中查找匹配的文档
        const targetItem = state.allItems.find(item => 
            item.file === resolvedPath || 
            item.file.endsWith(resolvedPath) ||
            resolvedPath.endsWith(item.file)
        );
        
        if (targetItem) {
            console.log('✅ 找到目标文档:', targetItem);
            
            // 加载文档
            trackPageReadTime();
            loadItem(
                targetItem.sIdx,
                targetItem.type === 'chapter' ? targetItem.bIdx : targetItem.iIdx,
                targetItem.type === 'chapter' ? targetItem.cIdx : -1,
                targetItem.type
            );
            
            // 如果有锚点，等待加载完成后滚动
            if (anchor) {
                setTimeout(() => scrollToAnchor(anchor), 500);
            }
        } else {
            console.warn('❌ 未找到目标文档:', resolvedPath);
            console.log('📋 可用文档列表:', state.allItems.map(i => i.file));
            alert(`未找到文档: ${targetFile}\n请检查链接是否正确。`);
        }
    } else {
        console.warn('⚠️ 不支持的链接格式:', href);
    }
}

/**
 * 滚动到指定锚点
 * @param {string} anchor - 锚点ID（不含#）
 */
function scrollToAnchor(anchor) {
    console.log('⚓ 滚动到锚点:', anchor);
    
    // marked.js会自动将标题转换为小写并替换空格为-
    const normalizedAnchor = anchor.toLowerCase().replace(/\s+/g, '-');
    
    // 尝试多种选择器
    const selectors = [
        `#${anchor}`,                    // 原始ID
        `#${normalizedAnchor}`,          // 标准化ID
        `[id="${anchor}"]`,              // 属性选择器
        `h1:contains("${anchor}")`,      // 标题文本匹配（备用）
        `h2:contains("${anchor}")`,
        `h3:contains("${anchor}")`
    ];
    
    let targetElement = null;
    for (const selector of selectors) {
        try {
            targetElement = document.querySelector(selector);
            if (targetElement) break;
        } catch (e) {
            // contains伪类不被支持，跳过
        }
    }
    
    if (targetElement) {
        const container = document.getElementById('readerContent');
        const elementTop = targetElement.offsetTop;
        const offset = 100; // 留出顶部空间
        
        container.scrollTo({
            top: elementTop - offset,
            behavior: 'smooth'
        });
        
        // 高亮目标元素（闪烁效果）
        targetElement.style.transition = 'background-color 0.3s';
        targetElement.style.backgroundColor = 'rgba(184, 115, 51, 0.2)';
        setTimeout(() => {
            targetElement.style.backgroundColor = '';
        }, 2000);
        
        console.log('✅ 已滚动到:', targetElement);
    } else {
        console.warn('❌ 未找到锚点元素:', anchor);
        console.log('💡 尝试的选择器:', selectors);
    }
}

/**
 * 搜索关键词高亮和定位
 * @param {string} keyword - 搜索关键词
 */
function highlightAndScrollToSearch(keyword) {
    console.log('🔍 开始高亮搜索关键词:', keyword);
    
    const contentArea = document.getElementById('content');
    if (!contentArea || !keyword) return;
    
    // 清除之前的高亮
    clearSearchHighlight();
    
    // 使用TreeWalker遍历所有文本节点
    const walker = document.createTreeWalker(
        contentArea,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // 跳过script和style标签
                if (node.parentElement.tagName === 'SCRIPT' || 
                    node.parentElement.tagName === 'STYLE') {
                    return NodeFilter.FILTER_REJECT;
                }
                // 跳过已经高亮的节点
                if (node.parentElement.classList && 
                    node.parentElement.classList.contains('search-highlight')) {
                    return NodeFilter.FILTER_REJECT;
                }
                // 包含关键词的文本节点
                if (node.textContent.toLowerCase().includes(keyword.toLowerCase())) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }
        }
    );
    
    const nodesToHighlight = [];
    let node;
    while (node = walker.nextNode()) {
        nodesToHighlight.push(node);
    }
    
    console.log(`📝 找到 ${nodesToHighlight.length} 个匹配的文本节点`);
    
    if (nodesToHighlight.length === 0) {
        console.warn('⚠️ 未找到匹配的文本');
        return;
    }
    
    // 高亮所有匹配的文本
    let firstHighlightElement = null;
    const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
    
    nodesToHighlight.forEach((textNode, index) => {
        const parent = textNode.parentElement;
        const text = textNode.textContent;
        
        // 创建包含高亮的HTML
        const highlightedHTML = text.replace(regex, '<mark class="search-highlight">$1</mark>');
        
        // 创建临时容器
        const temp = document.createElement('span');
        temp.innerHTML = highlightedHTML;
        
        // 替换原文本节点
        parent.replaceChild(temp, textNode);
        
        // 将temp的子节点提升到父级
        while (temp.firstChild) {
            const child = temp.firstChild;
            parent.insertBefore(child, temp);
            
            // 记录第一个高亮元素
            if (!firstHighlightElement && child.classList && 
                child.classList.contains('search-highlight')) {
                firstHighlightElement = child;
            }
        }
        parent.removeChild(temp);
    });
    
    // 滚动到第一个匹配位置
    if (firstHighlightElement) {
        const container = document.getElementById('readerContent');
        
        setTimeout(() => {
            // 使用getBoundingClientRect获取精确位置
            const containerRect = container.getBoundingClientRect();
            const elementRect = firstHighlightElement.getBoundingClientRect();
            const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
            const offset = 150; // 留出顶部空间
            
            container.scrollTo({
                top: Math.max(0, relativeTop - offset),
                behavior: 'smooth'
            });
            
            console.log('✅ 已滚动到第一个匹配位置:', relativeTop);
            
            // 第一个匹配项特殊高亮（脉冲效果）
            firstHighlightElement.classList.add('search-highlight-pulse');
            setTimeout(() => {
                if (firstHighlightElement.classList) {
                    firstHighlightElement.classList.remove('search-highlight-pulse');
                }
            }, 3000);
        }, 50);
    }
}

/**
 * 清除搜索高亮
 */
function clearSearchHighlight() {
    const highlights = document.querySelectorAll('.search-highlight');
    highlights.forEach(mark => {
        const parent = mark.parentNode;
        const text = document.createTextNode(mark.textContent);
        parent.replaceChild(text, mark);
        
        // 合并相邻的文本节点
        parent.normalize();
    });
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setupKeyboardShortcuts() {
    window.onkeydown = (e) => {
        // Cmd/Ctrl + F 打开搜索
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            e.preventDefault();
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }
        
        if (e.key === 'ArrowLeft' && !e.target.matches('input, textarea')) {
            navigateChapter(-1);
        }
        if (e.key === 'ArrowRight' && !e.target.matches('input, textarea')) {
            navigateChapter(1);
        }
        if (e.key === 'Escape') {
            document.getElementById('sidebar')?.classList.remove('open');
            document.getElementById('settingsDrawer')?.classList.remove('open');
            document.getElementById('searchResultsPanel')?.classList.remove('show');
            closeCommentSidebar?.();
        }
    };
}

/* ====== UNIFIED RIGHT PANEL (TOC + Comments) ====== */

function setupRightPanel() {
    if (document.getElementById('rightPanel')) return;
    const panel = document.createElement('aside');
    panel.id = 'rightPanel';
    panel.className = 'right-panel';
    panel.innerHTML = `
        <button id="rpCollapse" class="rp-collapse" aria-label="收起" title="收起目录/评论">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
        </button>
        <div class="rp-tabs">
            <button class="rp-tab active" data-tab="toc">📑 目录</button>
            <button class="rp-tab" data-tab="comments">💬 评论 <span id="rpCommentCount" class="rp-badge"></span></button>
            <button id="rpClose" class="rp-tab-close" aria-label="关闭">✕</button>
        </div>
        <div class="rp-pane active" id="rpPaneToc">
            <div id="rpTocBody" class="rp-toc-body"></div>
        </div>
        <div class="rp-pane" id="rpPaneComments">
            <div class="cs-quote" id="csQuote" style="display:none;"></div>
            <div class="cs-input-area">
                <textarea id="csInput" placeholder="写下你的想法…" rows="2"></textarea>
                <button id="csSubmitBtn" class="cs-submit">发布</button>
            </div>
            <div class="cs-list" id="csList"></div>
        </div>`;
    document.body.appendChild(panel);

    // 收起后的优雅竖条展开按钮（贴在屏幕右缘）
    if (!document.getElementById('rightPanelRail')) {
        const rail = document.createElement('button');
        rail.id = 'rightPanelRail';
        rail.className = 'right-panel-rail';
        rail.setAttribute('aria-label', '展开目录/评论');
        rail.setAttribute('title', '展开目录/评论');
        rail.innerHTML = `
            <span class="rail-glow" aria-hidden="true"></span>
            <span class="rail-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"></polyline></svg>
            </span>
            <span class="rail-label">目录 / 评论</span>
        `;
        rail.onclick = () => openRightPanel();
        document.body.appendChild(rail);
    }

    document.getElementById('rpClose').onclick = () => closeRightPanel();
    document.getElementById('rpCollapse').onclick = () => closeRightPanel();
    document.getElementById('csSubmitBtn').onclick = () => submitInlineComment();

    panel.querySelectorAll('.rp-tab[data-tab]').forEach(tab => {
        tab.onclick = () => switchRightPanelTab(tab.dataset.tab);
    });

    const headerBtn = document.getElementById('rightPanelToggle');
    if (headerBtn) headerBtn.onclick = () => toggleRightPanel();

    // 恢复持久化状态（仅桌面端；移动端保持默认收起）
    try {
        const saved = localStorage.getItem('godrise_right_panel_open');
        if (saved === '1' && window.innerWidth > 1024) {
            openRightPanel();
        } else {
            // 默认收起：显示 rail
            document.body.classList.add('right-panel-collapsed');
        }
    } catch (e) {
        document.body.classList.add('right-panel-collapsed');
    }
}

function switchRightPanelTab(tabName) {
    const panel = document.getElementById('rightPanel');
    panel.querySelectorAll('.rp-tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    document.getElementById('rpPaneToc').classList.toggle('active', tabName === 'toc');
    document.getElementById('rpPaneComments').classList.toggle('active', tabName === 'comments');
}

function toggleRightPanel() {
    const panel = document.getElementById('rightPanel');
    if (panel.classList.contains('open')) closeRightPanel();
    else openRightPanel();
}

function openRightPanel(focusComment) {
    const panel = document.getElementById('rightPanel');
    panel.classList.add('open');
    document.getElementById('rightPanelToggle')?.classList.add('panel-open');
    document.body.classList.remove('right-panel-collapsed');
    state.commentSidebarOpen = true;
    try { localStorage.setItem('godrise_right_panel_open', '1'); } catch (e) {}
    refreshRightPanelContent();
    if (focusComment) {
        switchRightPanelTab('comments');
        setTimeout(() => document.getElementById('csInput')?.focus(), 200);
    }
}

function closeRightPanel() {
    document.getElementById('rightPanel')?.classList.remove('open');
    document.getElementById('rightPanelToggle')?.classList.remove('panel-open');
    // 桌面端收起后在右缘显示 rail 展开按钮；移动端不显示 rail
    if (window.innerWidth > 1024) {
        document.body.classList.add('right-panel-collapsed');
    } else {
        document.body.classList.remove('right-panel-collapsed');
    }
    state.commentSidebarOpen = false;
    try { localStorage.setItem('godrise_right_panel_open', '0'); } catch (e) {}
}

function refreshRightPanelContent() {
    generatePanelTOC();
    renderInlineComments();
    updateCommentBadge();
}

function generatePanelTOC() {
    const tocBody = document.getElementById('rpTocBody');
    const contentArea = document.getElementById('content');
    if (!tocBody || !contentArea) return;

    const headings = contentArea.querySelectorAll('h1, h2, h3');
    if (headings.length < 2) {
        tocBody.innerHTML = '<p class="rp-empty">本页无目录</p>';
        return;
    }
    tocBody.innerHTML = '';
    headings.forEach((heading, index) => {
        const level = parseInt(heading.tagName.charAt(1));
        const text = heading.textContent.trim();
        if (!heading.id) heading.id = `toc-heading-${index}`;
        const item = document.createElement('div');
        item.className = `toc-item level-${level}`;
        item.textContent = text;
        item.setAttribute('data-target', heading.id);
        item.onclick = () => scrollToHeading(heading.id);
        tocBody.appendChild(item);
    });
}

function scrollToHeading(headingId) {
    const heading = document.getElementById(headingId);
    if (!heading) return;
    const container = document.getElementById('readerContent');
    container.scrollTo({ top: heading.offsetTop - 120, behavior: 'smooth' });
    const path = state._lastPath || (state.currentItem ? getPathFromItem(state.allItems.find(i =>
        i.sIdx === state.currentItem.sIdx &&
        (state.currentItem.type === 'chapter' ? (i.bIdx === state.currentItem.idx1 && i.cIdx === state.currentItem.idx2) : i.iIdx === state.currentItem.idx1)
    )) : '');
    if (path) window.location.hash = path + '#' + headingId;
    heading.style.transition = 'background-color 0.3s';
    heading.style.backgroundColor = 'rgba(184, 115, 51, 0.15)';
    setTimeout(() => { heading.style.backgroundColor = ''; }, 1500);
}

function initTOCScrollSpy() {
    const container = document.getElementById('readerContent');
    const contentArea = document.getElementById('content');
    if (!container || !contentArea) return;
    let ticking = false;
    container.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => { updateActiveTOCItem(); ticking = false; });
            ticking = true;
        }
    });
}

function updateActiveTOCItem() {
    const container = document.getElementById('readerContent');
    const contentArea = document.getElementById('content');
    const tocItems = document.querySelectorAll('#rpTocBody .toc-item');
    if (!container || !contentArea || tocItems.length === 0) return;
    const headings = contentArea.querySelectorAll('h1, h2, h3');
    const containerRect = container.getBoundingClientRect();
    let activeId = null;
    headings.forEach(heading => {
        if (heading.getBoundingClientRect().top - containerRect.top <= 180) activeId = heading.id;
    });
    tocItems.forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-target') === activeId);
    });
}

function updateCommentBadge() {
    const el = document.getElementById('rpCommentCount');
    if (!el) return;
    const key = getPageKey();
    const count = countCommentsRecursive(state.inlineComments[key] || []);
    el.textContent = count > 0 ? `(${count})` : '';
}

function countCommentsRecursive(arr) {
    let n = 0;
    for (const c of arr) { n++; if (c.replies) n += countCommentsRecursive(c.replies); }
    return n;
}

function getTotalCommentCount() {
    let total = countCommentsRecursive(state.comments);
    for (const key of Object.keys(state.inlineComments)) {
        total += countCommentsRecursive(state.inlineComments[key]);
    }
    return total;
}

function generatePageTOC() { refreshRightPanelContent(); }
function hideTOC() { }
function setupTOCToggle() { }
function setupCommentSidebar() { setupRightPanel(); }

function openCommentSidebar(quote) {
    const quoteEl = document.getElementById('csQuote');
    const panel = document.getElementById('rightPanel');
    if (quote) {
        quoteEl.textContent = `"${quote.length > 100 ? quote.substring(0, 100) + '…' : quote}"`;
        quoteEl.style.display = 'block';
        panel._quote = quote;
    } else {
        quoteEl.style.display = 'none';
        panel._quote = '';
    }
    openRightPanel(true);
}

function closeCommentSidebar() { closeRightPanel(); }

/* ====== NICKNAME SYSTEM (no login required) ====== */
function showNicknamePrompt(callback) {
    let modal = document.getElementById('nickModal');
    if (modal) { modal.remove(); }
    modal = document.createElement('div');
    modal.id = 'nickModal';
    modal.className = 'login-overlay';
    modal.innerHTML = `
    <div class="login-card">
        <div class="login-logo">起个名字</div>
        <p class="login-subtitle">留言需要一个昵称，仅此而已</p>
        <div class="login-field">
            <label>昵称</label>
            <input type="text" id="nickInput" placeholder="你的名字" maxlength="20" autocomplete="nickname"/>
        </div>
        <button id="nickSubmit" class="login-btn">确定</button>
        <button id="nickCancel" class="login-btn" style="background:var(--bg-sidebar);color:var(--text-secondary);margin-top:0.5rem;">取消</button>
    </div>`;
    document.body.appendChild(modal);
    document.getElementById('nickSubmit').onclick = () => {
        const nick = document.getElementById('nickInput').value.trim();
        if (!nick) { alert('请输入昵称'); return; }
        state.user = { nickname: nick, email: nick + '@reader', joinedAt: new Date().toISOString() };
        localStorage.setItem('slsh_user', JSON.stringify(state.user));
        modal.remove();
        updateUserDisplay();
        if (callback) callback();
    };
    document.getElementById('nickCancel').onclick = () => { modal.remove(); };
    document.getElementById('nickInput').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('nickSubmit').click(); });
    setTimeout(() => document.getElementById('nickInput').focus(), 100);
}

function ensureLoggedIn(callback) {
    if (state.user) return true;
    showNicknamePrompt(callback);
    return false;
}

function updateUserDisplay() {
    if (!state.user) return;
    let badge = document.getElementById('userBadge');
    if (!badge) {
        badge = document.createElement('span');
        badge.id = 'userBadge';
        badge.className = 'user-badge';
        const actions = document.querySelector('.header-actions');
        if (actions) actions.insertBefore(badge, actions.firstChild);
    }
    badge.textContent = state.user.nickname;
    badge.title = state.user.email;
    badge.onclick = () => {
        if (confirm(`当前账号：${state.user.nickname}\n邮箱：${state.user.email}\n\n是否退出登录？`)) {
            state.user = null;
            localStorage.removeItem('slsh_user');
            location.reload();
        }
    };
}

/* ====== COPY PROTECTION removed - reader-friendly ====== */

/* ====== INLINE COMMENTS (text selection) ====== */
function setupInlineComments() {
    const contentArea = document.getElementById('readerContent');
    if (!contentArea) return;
    
    let popup = document.getElementById('commentPopup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'commentPopup';
        popup.className = 'comment-popup';
        popup.innerHTML = '<button id="popupCommentBtn" class="popup-comment-btn">💬 评论</button>';
        document.body.appendChild(popup);
    }
    
    function showPopupForSelection() {
        setTimeout(() => {
            const sel = window.getSelection();
            const text = sel.toString().trim();
            if (text.length > 2 && text.length < 500) {
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                popup.style.display = 'block';
                popup.style.top = (rect.top + window.scrollY - 40) + 'px';
                popup.style.left = (rect.left + rect.width / 2 - 40) + 'px';
                popup._selectedText = text;
            } else {
                popup.style.display = 'none';
            }
        }, 10);
    }

    contentArea.addEventListener('mouseup', showPopupForSelection);
    contentArea.addEventListener('touchend', showPopupForSelection);

    document.addEventListener('mousedown', e => {
        if (!e.target.closest('#commentPopup')) popup.style.display = 'none';
    });
    document.addEventListener('touchstart', e => {
        if (!e.target.closest('#commentPopup')) popup.style.display = 'none';
    });
    
    document.getElementById('popupCommentBtn').onclick = () => {
        const quote = popup._selectedText;
        popup.style.display = 'none';
        openCommentSidebar(quote);
    };
}

/* old setupCommentSidebar/openCommentSidebar/closeCommentSidebar replaced by unified right panel */

function getPageKey() {
    if (!state.currentItem) return 'home';
    return `${state.currentItem.sIdx}-${state.currentItem.idx1}-${state.currentItem.idx2}`;
}

async function submitInlineComment() {
    const input = document.getElementById('csInput');
    const val = input?.value.trim();
    if (!val) return;

    const doSubmit = () => {
        const panel = document.getElementById('rightPanel');
        const key = getPageKey();
        if (!state.inlineComments[key]) state.inlineComments[key] = [];
        const comment = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            user: state.user ? state.user.nickname : '匿名读者',
            email: state.user ? state.user.email : 'anon',
            text: val,
            quote: panel._quote || '',
            time: new Date().toLocaleString(),
            replies: []
        };
        state.inlineComments[key].unshift(comment);
        localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments));
        input.value = '';
        panel._quote = '';
        document.getElementById('csQuote').style.display = 'none';
        renderInlineComments();
        updateCommentBadge();
        apiCall('/api/inline-comments', 'POST', { page: key, action: 'add', comment }).then(r => {
            if (r && r.comments) { state.inlineComments[key] = r.comments; localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments)); renderInlineComments(); }
        });
    };

    if (!state.user) {
        showNicknamePrompt(doSubmit);
    } else {
        doSubmit();
    }
}

function renderInlineComments() {
    const list = document.getElementById('csList');
    if (!list) return;
    const key = getPageKey();
    const comments = state.inlineComments[key] || [];
    if (comments.length === 0) {
        list.innerHTML = '<p class="cs-empty">本页暂无评论</p>';
        return;
    }
    list.innerHTML = comments.map(c => renderSidebarCommentHTML(c, 0)).join('');
    list.querySelectorAll('.reply-btn').forEach(btn => { btn.onclick = () => toggleInlineReplyBox(btn.dataset.id); });
    list.querySelectorAll('.reply-submit').forEach(btn => { btn.onclick = () => submitInlineReply(btn.dataset.id); });
    list.querySelectorAll('.delete-comment-btn').forEach(btn => { btn.onclick = () => deleteInlineComment(btn.dataset.id); });

    syncInlineFromCloud(key).then(() => {
        const updated = state.inlineComments[key] || [];
        if (updated.length !== comments.length) {
            list.innerHTML = updated.map(c => renderSidebarCommentHTML(c, 0)).join('');
            list.querySelectorAll('.reply-btn').forEach(btn => { btn.onclick = () => toggleInlineReplyBox(btn.dataset.id); });
            list.querySelectorAll('.reply-submit').forEach(btn => { btn.onclick = () => submitInlineReply(btn.dataset.id); });
            list.querySelectorAll('.delete-comment-btn').forEach(btn => { btn.onclick = () => deleteInlineComment(btn.dataset.id); });
            updateCommentBadge();
        }
    });
}

function renderSidebarCommentHTML(c, depth) {
    const indent = Math.min(depth, 3) * 0.75;
    const avatar = (c.user || '?').charAt(0).toUpperCase();
    const isOwn = state.user && c.email === state.user.email;
    const repliesHTML = (c.replies || []).map(r => renderSidebarCommentHTML(r, depth + 1)).join('');
    return `
    <div class="cs-comment" style="margin-left:${indent}rem;${depth > 0 ? 'border-left:2px solid var(--border);padding-left:0.5rem;' : ''}">
        <div class="cs-comment-header">
            <span class="comment-avatar sm">${avatar}</span>
            <span class="cs-user">${c.user}</span>
            <span class="cs-time">${c.time}</span>
            ${isOwn ? `<button class="delete-comment-btn" data-id="${c.id}">✕</button>` : ''}
        </div>
        ${c.quote ? `<div class="cs-quote-inline">"${c.quote.length > 40 ? c.quote.substring(0, 40) + '…' : c.quote}"</div>` : ''}
        <div class="cs-text">${escapeHTML(c.text)}</div>
        <button class="reply-btn sm" data-id="${c.id}">回复</button>
        <div class="reply-box" id="ir-box-${c.id}" style="display:none;">
            <textarea class="reply-input" id="ir-input-${c.id}" placeholder="回复 ${c.user}…" rows="2"></textarea>
            <button class="reply-submit" data-id="${c.id}">发送</button>
        </div>
        ${repliesHTML}
    </div>`;
}

function toggleInlineReplyBox(id) {
    const box = document.getElementById('ir-box-' + id);
    if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function submitInlineReply(parentId) {
    const input = document.getElementById('ir-input-' + parentId);
    const val = input?.value.trim();
    if (!val) return;

    const doReply = () => {
        const key = getPageKey();
        const reply = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            user: state.user ? state.user.nickname : '匿名读者',
            email: state.user ? state.user.email : 'anon',
            text: val, time: new Date().toLocaleString(), replies: []
        };
        function add(arr) {
            for (const c of arr) { if (c.id === parentId) { c.replies = c.replies || []; c.replies.push(reply); return true; } if (c.replies && add(c.replies)) return true; }
            return false;
        }
        add(state.inlineComments[key] || []);
        localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments));
        renderInlineComments();
        apiCall('/api/inline-comments', 'POST', { page: key, action: 'reply', parentId, reply }).then(r => {
            if (r && r.comments) { state.inlineComments[key] = r.comments; localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments)); }
        });
    };

    if (!state.user) {
        showNicknamePrompt(doReply);
    } else {
        doReply();
    }
}

async function deleteInlineComment(id) {
    const key = getPageKey();
    function remove(arr) { const idx = arr.findIndex(c => c.id === id); if (idx >= 0) { arr.splice(idx, 1); return true; } for (const c of arr) { if (c.replies && remove(c.replies)) return true; } return false; }
    if (confirm('确定删除？')) {
        remove(state.inlineComments[key] || []);
        localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments));
        renderInlineComments();
        const r = await apiCall('/api/inline-comments', 'POST', { page: key, action: 'delete', id });
        if (r && r.comments) { state.inlineComments[key] = r.comments; localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments)); }
    }
}

/* ====== VOTING SYSTEM ====== */
const votes = JSON.parse(localStorage.getItem('slsh_votes') || '{}');

async function loadVotes(pageKey) {
    const data = await apiCall('/api/votes?page=' + encodeURIComponent(pageKey));
    if (data && typeof data.likes === 'number') return data;
    return { likes: 0 };
}

async function submitVote(pageKey) {
    const myVotes = JSON.parse(localStorage.getItem('slsh_my_votes') || '{}');
    if (myVotes[pageKey]) {
        // Toggle off
        delete myVotes[pageKey];
        localStorage.setItem('slsh_my_votes', JSON.stringify(myVotes));
        await apiCall('/api/votes', 'POST', { page: pageKey, action: 'unlike' });
    } else {
        myVotes[pageKey] = true;
        localStorage.setItem('slsh_my_votes', JSON.stringify(myVotes));
        await apiCall('/api/votes', 'POST', { page: pageKey, action: 'like' });
    }
    renderVoteButton(pageKey);
}

async function renderVoteButton(pageKey) {
    const container = document.getElementById('voteContainer');
    if (!container) return;
    const myVotes = JSON.parse(localStorage.getItem('slsh_my_votes') || '{}');
    const isLiked = !!myVotes[pageKey];
    const data = await loadVotes(pageKey);
    const count = data.likes || 0;
    container.innerHTML = `
        <button class="vote-btn ${isLiked ? 'voted' : ''}" onclick="submitVote('${pageKey}')">
            <span class="vote-icon">${isLiked ? '❤️' : '🤍'}</span>
            <span class="vote-count">${count > 0 ? count : ''}</span>
            <span class="vote-label">${isLiked ? '已喜欢' : '喜欢本章'}</span>
        </button>
    `;
}

window.submitVote = submitVote;

/* ====== TOUCH SWIPE NAVIGATION ====== */
function setupSwipeNavigation() {
    const reader = document.getElementById('readerContent');
    if (!reader) return;
    let startX = 0, startY = 0, startTime = 0;
    reader.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
    }, { passive: true });
    reader.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        const dt = Date.now() - startTime;
        // Quick horizontal swipe (>80px, <300ms, more horizontal than vertical)
        if (dt < 300 && Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
            if (dx > 0) navigateChapter(-1); // swipe right = prev
            else navigateChapter(1); // swipe left = next
        }
    }, { passive: true });
}

