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
    apiAvailable: null
};

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
    initCopyProtection();
    if (!state.user) { showLoginModal(); return; }
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
    if (!raw || raw.length <= 1) return;
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
        const response = await fetch('web-reader/chapters.json?v=' + Date.now());
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
    
    closeRightPanel();
    state.currentItem = { sIdx, idx1, idx2, type };
    state.pageReadStart = Date.now();
    
    const item = state.allItems.find(i => 
        i.sIdx === sIdx && 
        (type === 'chapter' ? (i.bIdx === idx1 && i.cIdx === idx2) : i.iIdx === idx1)
    );
    const path = item ? getPathFromItem(item) : '';
    window.location.hash = path + (scrollAnchor ? '#' + scrollAnchor : '');
    
    contentArea.style.transition = 'opacity 0.2s';
    contentArea.style.opacity = '0';
    
    try {
        const item = state.allItems.find(i => 
            i.sIdx === sIdx && 
            (type === 'chapter' ? (i.bIdx === idx1 && i.cIdx === idx2) : i.iIdx === idx1)
        );
        
        if (!item) throw new Error('未找到内容');
        
        setTimeout(async () => {
            contentArea.innerHTML = '<div style="text-align: center; padding: 4rem; color: var(--text-muted);">正在加载...</div>';
            contentArea.style.opacity = '1';

            const path = resolvePath(item.file);
            const response = await fetch(path);
            if (!response.ok) throw new Error('文件加载失败');
            
            const markdown = await response.text();
            const html = markdownToHTML(markdown);
            
            // 存储当前文档路径，用于解析相对链接
            state.currentDocPath = item.file;
            
            // 构建导航按钮
            const currentIdx = state.allItems.findIndex(i => 
                i.sIdx === sIdx && 
                (type === 'chapter' ? (i.bIdx === idx1 && i.cIdx === idx2) : i.iIdx === idx1)
            );
            
            const hasPrev = currentIdx > 0;
            const hasNext = currentIdx < state.allItems.length - 1;
            
            contentArea.innerHTML = `
                <div class="chapter-content">
                    <div class="chapter-nav-top">
                        <button class="chapter-nav-btn" id="topPrevBtn" ${!hasPrev ? 'disabled' : ''}>‹ 上一章</button>
                        <span class="chapter-info-inline">${item.bookTitle || item.sectionTitle} · ${item.title}</span>
                        <button class="chapter-nav-btn" id="topNextBtn" ${!hasNext ? 'disabled' : ''}>下一章 ›</button>
                    </div>
                    ${html}
                    <div class="chapter-nav-bottom">
                        <button class="chapter-nav-btn" id="bottomPrevBtn" ${!hasPrev ? 'disabled' : ''}>‹ 上一章</button>
                        <span class="chapter-info-inline">${item.bookTitle || item.sectionTitle}</span>
                        <button class="chapter-nav-btn" id="bottomNextBtn" ${!hasNext ? 'disabled' : ''}>下一章 ›</button>
                    </div>
                </div>
            `;
            
            // 绑定按钮事件
            if (hasPrev) {
                document.getElementById('topPrevBtn').onclick = () => navigateChapter(-1);
                document.getElementById('bottomPrevBtn').onclick = () => navigateChapter(-1);
            }
            if (hasNext) {
                document.getElementById('topNextBtn').onclick = () => navigateChapter(1);
                document.getElementById('bottomNextBtn').onclick = () => navigateChapter(1);
            }
            
            updateActiveNavItem();
            
            // 设置内部链接拦截
            setupInternalLinks();
            
            // 生成页内目录（TOC）
            generatePageTOC();
            
            // 确保当前项的目录section是展开的
            expandNavToCurrentItem();
            
            const readerContent = document.getElementById('readerContent');
            
            // 如果有搜索关键词，进行高亮和定位（不重置滚动位置）
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

            if (window.innerWidth <= 1024) {
                document.getElementById('sidebar').classList.remove('open');
            }
            if (window.innerWidth > 1024) {
                openRightPanel(false);
                switchRightPanelTab('toc');
            }
        }, 200);
        
    } catch (error) {
        contentArea.innerHTML = `<div style="text-align: center; padding: 4rem; color: var(--text-muted);">加载失败: ${error.message}</div>`;
        contentArea.style.opacity = '1';
    }
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
    marked.use({ renderer });
    
    // 使用marked渲染Markdown
    return marked.parse(md);
}

function initUI() {
    const mainTitle = document.getElementById('mainTitle');
    if (mainTitle) {
        mainTitle.onclick = () => {
            location.reload();
        };
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
}

function scrollToSectionAndLoad(section) {
    const nav = document.getElementById('chapterNav');
    const sections = nav.querySelectorAll('.encyclopedia-section');
    
    sections.forEach((sec) => {
        const title = sec.querySelector('.section-title');
        const content = sec.querySelector('.section-content');
        
        if (title) {
            const text = title.textContent.toLowerCase();
            const matches = 
                text.includes(section) || 
                (section === 'world-building' && text.includes('世界观')) ||
                (section === 'characters' && text.includes('人物')) ||
                (section === 'chapters' && text.includes('正文')) ||
                (section === 'reference' && text.includes('参考'));
            
            if (matches) {
                if (window.innerWidth <= 1024) {
                    document.getElementById('sidebar').classList.add('open');
                }
                
                if (content) {
                    title.classList.add('active');
                    content.classList.add('open');
                    content.style.maxHeight = content.scrollHeight + 'px';
                }
                
                setTimeout(() => {
                    title.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
                
                setTimeout(() => {
                    const firstItem = content?.querySelector('.chapter-item');
                    if (firstItem) {
                        firstItem.click();
                    }
                }, 300);
            }
        }
    });
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
    if (!ensureLoggedIn()) return;
    const input = document.getElementById('comInput');
    const val = input?.value.trim();
    if (!val) return;

    const comment = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        user: state.user.nickname,
        email: state.user.email,
        text: val,
        time: new Date().toLocaleString(),
        replies: []
    };

    state.comments.unshift(comment);
    localStorage.setItem('comments', JSON.stringify(state.comments));
    input.value = '';
    renderComments();

    const r = await apiCall('/api/comments', 'POST', { action: 'add', comment });
    if (r && r.comments) { state.comments = r.comments; localStorage.setItem('comments', JSON.stringify(r.comments)); renderComments(); }
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
    if (!ensureLoggedIn()) return;
    const box = document.getElementById('reply-box-' + commentId);
    if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function submitReply(parentId) {
    const input = document.getElementById('reply-input-' + parentId);
    const val = input?.value.trim();
    if (!val) return;

    const reply = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        user: state.user.nickname,
        email: state.user.email,
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

    const r = await apiCall('/api/comments', 'POST', { action: 'reply', parentId, reply });
    if (r && r.comments) { state.comments = r.comments; localStorage.setItem('comments', JSON.stringify(r.comments)); renderComments(); }
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
    
    if (searchBtn) {
        searchBtn.onclick = () => {
            const query = searchInput?.value.trim();
            if (query) {
                performSearch(query);
            }
        };
    }
    
    if (searchInput) {
        searchInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) {
                    performSearch(query);
                }
            }
        };
    }
    
    if (closeSearch) {
        closeSearch.onclick = () => {
            document.getElementById('searchResultsPanel')?.classList.remove('show');
        };
    }
    
    // 点击目录或其他区域时关闭搜索面板
    document.getElementById('sidebar')?.addEventListener('click', () => {
        document.getElementById('searchResultsPanel')?.classList.remove('show');
    });
    document.getElementById('readerContent')?.addEventListener('click', () => {
        document.getElementById('searchResultsPanel')?.classList.remove('show');
    });
}

async function performSearch(query) {
    const panel = document.getElementById('searchResultsPanel');
    const list = document.getElementById('searchResultsList');
    
    if (!panel || !list) return;
    
    list.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">搜索中...</div>';
    panel.classList.add('show');
    
    // 按文档分组的结果，每个文档包含多个匹配
    const groupedResults = [];
    
    for (const item of state.allItems) {
        try {
            const path = resolvePath(item.file);
            const response = await fetch(path);
            if (response.ok) {
                const text = await response.text();
                const lowerText = text.toLowerCase();
                const lowerQuery = query.toLowerCase();
                
                // 查找所有匹配
                const matches = [];
                let searchIndex = 0;
                let matchIndex;
                
                while ((matchIndex = lowerText.indexOf(lowerQuery, searchIndex)) !== -1) {
                    const start = Math.max(0, matchIndex - 50);
                    const end = Math.min(text.length, matchIndex + query.length + 50);
                    const snippet = text.substring(start, end);
                    
                    // 计算行号（用于定位）
                    const lineNum = text.substring(0, matchIndex).split('\n').length;
                    
                    matches.push({ 
                        snippet, 
                        position: matchIndex,
                        lineNum 
                    });
                    searchIndex = matchIndex + query.length;
                }
                
                if (matches.length > 0) {
                    groupedResults.push({ item, matches, matchCount: matches.length });
                }
            }
        } catch (error) {
            console.error(`搜索 ${item.title} 失败:`, error);
        }
    }
    
    // 计算总匹配数
    const totalMatches = groupedResults.reduce((sum, g) => sum + g.matchCount, 0);
    
    if (groupedResults.length === 0) {
        list.innerHTML = '<div class="no-results">未找到相关内容</div>';
    } else {
        let html = `<div class="search-summary">在 ${groupedResults.length} 个文档中找到 ${totalMatches} 个匹配</div>`;
        
        html += groupedResults.map((g, gIdx) => {
            const displayTitle = g.item.type === 'chapter' 
                ? `${g.item.bookTitle} · ${g.item.title}`
                : `${g.item.sectionTitle} · ${g.item.title}`;
            
            const matchesHtml = g.matches.map((m, mIdx) => {
                const snippet = m.snippet.replace(
                    new RegExp(query, 'gi'),
                    match => `<mark>${match}</mark>`
                );
                return `
                    <div class="search-match-item" 
                         data-sidx="${g.item.sIdx}" 
                         data-type="${g.item.type}" 
                         data-idx1="${g.item.type === 'chapter' ? g.item.bIdx : g.item.iIdx}" 
                         data-idx2="${g.item.type === 'chapter' ? g.item.cIdx : -1}"
                         data-position="${m.position}"
                         data-query="${encodeURIComponent(query)}">
                        <span class="match-line">L${m.lineNum}</span>
                        <span class="match-snippet">...${snippet}...</span>
                    </div>
                `;
            }).join('');
            
            return `
                <div class="search-result-group">
                    <div class="result-group-header" data-gidx="${gIdx}">
                        <span class="group-toggle">▼</span>
                        <span class="group-title">${displayTitle}</span>
                        <span class="group-count">${g.matchCount} 个匹配</span>
                    </div>
                    <div class="result-group-matches" id="group-matches-${gIdx}">
                        ${matchesHtml}
                    </div>
                </div>
            `;
        }).join('');
        
        list.innerHTML = html;
        
        // 折叠/展开事件
        list.querySelectorAll('.result-group-header').forEach(header => {
            header.onclick = () => {
                const gIdx = header.dataset.gidx;
                const matchesEl = document.getElementById(`group-matches-${gIdx}`);
                const toggle = header.querySelector('.group-toggle');
                if (matchesEl.style.display === 'none') {
                    matchesEl.style.display = 'block';
                    toggle.textContent = '▼';
                } else {
                    matchesEl.style.display = 'none';
                    toggle.textContent = '▶';
                }
            };
        });
        
        // 点击匹配项跳转并定位
        list.querySelectorAll('.search-match-item').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const sIdx = parseInt(el.dataset.sidx);
                const type = el.dataset.type;
                const idx1 = parseInt(el.dataset.idx1);
                const idx2 = parseInt(el.dataset.idx2);
                const position = parseInt(el.dataset.position);
                const searchQuery = decodeURIComponent(el.dataset.query);
                
                // 保存搜索关键词和位置，用于文档加载后定位高亮
                state.searchHighlight = { query: searchQuery, position };
                
                trackPageReadTime();
                loadItem(sIdx, idx1, idx2, type);
                panel.classList.remove('show');
            };
        });
    }
}

async function updateStats() {
    const totalEl = document.getElementById('totalChapters');
    const wordsEl = document.getElementById('totalWords');
    const settingWordsEl = document.getElementById('settingWords');
    const chapterWordsEl = document.getElementById('chapterWords');
    
    const formatCount = (n) => n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString();
    
    if (totalEl) totalEl.textContent = state.allItems.length;
    
    let chapterWordCount = 0;
    let settingWordCount = 0;
    
    state.allItems.forEach(item => {
        const wc = item.wordCount || 0;
        if (item.type === 'chapter') chapterWordCount += wc;
        else settingWordCount += wc;
    });
    
    state.cachedChapterWords = chapterWordCount;
    state.cachedSettingWords = settingWordCount;
    
    if (chapterWordsEl) chapterWordsEl.textContent = formatCount(chapterWordCount);
    if (settingWordsEl) settingWordsEl.textContent = formatCount(settingWordCount);
    if (wordsEl) wordsEl.textContent = formatCount(settingWordCount + chapterWordCount);
    
    console.log(`📊 字数统计: 设定${formatCount(settingWordCount)}, 正文${formatCount(chapterWordCount)}`);
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
        <div class="rp-tabs">
            <button class="rp-tab active" data-tab="toc">📑 目录</button>
            <button class="rp-tab" data-tab="comments">💬 评论 <span id="rpCommentCount" class="rp-badge"></span></button>
            <button id="rpClose" class="rp-tab-close">✕</button>
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

    document.getElementById('rpClose').onclick = () => closeRightPanel();
    document.getElementById('csSubmitBtn').onclick = () => submitInlineComment();

    panel.querySelectorAll('.rp-tab[data-tab]').forEach(tab => {
        tab.onclick = () => switchRightPanelTab(tab.dataset.tab);
    });

    const headerBtn = document.getElementById('rightPanelToggle');
    if (headerBtn) headerBtn.onclick = () => toggleRightPanel();
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
    state.commentSidebarOpen = true;
    refreshRightPanelContent();
    if (focusComment) {
        switchRightPanelTab('comments');
        setTimeout(() => document.getElementById('csInput')?.focus(), 200);
    }
}

function closeRightPanel() {
    document.getElementById('rightPanel')?.classList.remove('open');
    document.getElementById('rightPanelToggle')?.classList.remove('panel-open');
    state.commentSidebarOpen = false;
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

/* ====== LOGIN SYSTEM ====== */
function showLoginModal() {
    let modal = document.getElementById('loginModal');
    if (modal) { modal.style.display = 'flex'; return; }
    modal = document.createElement('div');
    modal.id = 'loginModal';
    modal.className = 'login-overlay';
    modal.innerHTML = `
    <div class="login-card">
        <div class="login-logo">《神临山海》</div>
        <p class="login-subtitle">史诗硬核科幻神话四部曲</p>
        <div class="login-field">
            <label>邮箱</label>
            <input type="email" id="loginEmail" placeholder="your@email.com" autocomplete="email"/>
        </div>
        <div class="login-field">
            <label>昵称</label>
            <input type="text" id="loginNick" placeholder="起一个名字" maxlength="20" autocomplete="nickname"/>
        </div>
        <button id="loginSubmit" class="login-btn">进入山海</button>
        <p class="login-note">无需密码，仅用于评论署名</p>
    </div>`;
    document.body.appendChild(modal);
    document.getElementById('loginSubmit').onclick = handleLogin;
    document.getElementById('loginNick').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
}

function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const nick = document.getElementById('loginNick').value.trim();
    if (!email || !nick) { alert('请填写邮箱和昵称'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('请输入有效的邮箱地址'); return; }
    state.user = { email, nickname: nick, joinedAt: new Date().toISOString() };
    localStorage.setItem('slsh_user', JSON.stringify(state.user));
    const users = JSON.parse(localStorage.getItem('slsh_users') || '[]');
    if (!users.find(u => u.email === email)) { users.push(state.user); localStorage.setItem('slsh_users', JSON.stringify(users)); }
    document.getElementById('loginModal').style.display = 'none';
    bootApp();
}

function ensureLoggedIn() {
    if (state.user) return true;
    showLoginModal();
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

/* ====== COPY PROTECTION ====== */
function initCopyProtection() {
    const style = document.createElement('style');
    style.textContent = `@media print { body { display: none !important; } }`;
    document.head.appendChild(style);
    document.addEventListener('copy', e => {
        if (!e.target.closest('input, textarea')) e.preventDefault();
    });
    document.addEventListener('cut', e => {
        if (!e.target.closest('input, textarea')) e.preventDefault();
    });
    document.addEventListener('contextmenu', e => {
        if (!e.target.closest('input, textarea')) e.preventDefault();
    });
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && ['p','P','s','S'].includes(e.key)) {
            if (!e.target.closest('input, textarea')) e.preventDefault();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            if (!e.target.closest('input, textarea')) e.preventDefault();
        }
    });
}

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
    
    contentArea.addEventListener('mouseup', () => {
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
    });
    
    document.addEventListener('mousedown', e => {
        if (!e.target.closest('#commentPopup')) popup.style.display = 'none';
    });
    
    document.getElementById('popupCommentBtn').onclick = () => {
        if (!ensureLoggedIn()) return;
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
    if (!ensureLoggedIn()) return;
    const input = document.getElementById('csInput');
    const val = input.value.trim();
    if (!val) return;
    const panel = document.getElementById('rightPanel');
    const key = getPageKey();
    if (!state.inlineComments[key]) state.inlineComments[key] = [];

    const comment = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        user: state.user.nickname,
        email: state.user.email,
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

    const r = await apiCall('/api/inline-comments', 'POST', { page: key, action: 'add', comment });
    if (r && r.comments) { state.inlineComments[key] = r.comments; localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments)); renderInlineComments(); }
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
    if (!ensureLoggedIn()) return;
    const box = document.getElementById('ir-box-' + id);
    if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function submitInlineReply(parentId) {
    const input = document.getElementById('ir-input-' + parentId);
    const val = input?.value.trim();
    if (!val) return;
    const key = getPageKey();
    const reply = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        user: state.user.nickname, email: state.user.email,
        text: val, time: new Date().toLocaleString(), replies: []
    };
    function add(arr) {
        for (const c of arr) { if (c.id === parentId) { c.replies = c.replies || []; c.replies.push(reply); return true; } if (c.replies && add(c.replies)) return true; }
        return false;
    }
    add(state.inlineComments[key] || []);
    localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments));
    renderInlineComments();

    const r = await apiCall('/api/inline-comments', 'POST', { page: key, action: 'reply', parentId, reply });
    if (r && r.comments) { state.inlineComments[key] = r.comments; localStorage.setItem('inlineComments', JSON.stringify(state.inlineComments)); }
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
