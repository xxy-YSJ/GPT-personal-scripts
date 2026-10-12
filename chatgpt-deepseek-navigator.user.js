// ==UserScript==
// @name         ChatGPT DeepSeek Navigator
// @namespace    chatgpt-deepseek-nav
// @version      13.4.0
// @description  ChatGPT 右侧 DeepSeek 风格消息导航
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @homepageURL  https://github.com/xxy-YSJ/GPT-personal-scripts
// @updateURL    https://raw.githubusercontent.com/xxy-YSJ/GPT-personal-scripts/main/chatgpt-deepseek-navigator.user.js
// @downloadURL  https://raw.githubusercontent.com/xxy-YSJ/GPT-personal-scripts/main/chatgpt-deepseek-navigator.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';


    // =========================================================
    // 配置
    // =========================================================

    const NAV_ID =
        'chatgpt-deepseek-nav-v134';

    const TIP_ID =
        'chatgpt-deepseek-tip-v134';


    const NAV_WIDTH = 200;

    const ROW_HEIGHT = 20;

    const FONT_SIZE = 12;

    const NORMAL_LINE_WIDTH = 10;

    // 蓝线视觉长度 = 普通线 2 倍
    const ACTIVE_LINE_SCALE = 2;

    // 固定给蓝线预留的区域
    const LINE_BOX_WIDTH = 20;

    const MAX_NAV_HEIGHT = '75vh';

    const TITLE_LENGTH = 30;

    const ACTIVE_VIEWPORT_RATIO = 0.40;

    // 手动滚动导航后，暂停自动居中 3 秒
    const NAV_MANUAL_PAUSE = 3000;

    // 点击“重试 / 重新生成 / 切换分支”后，
    // 等待 ChatGPT 完成 DOM 更新
    const BRANCH_RESET_DELAY = 1100;


    // =========================================================
    // 状态
    // =========================================================

    let messages = [];

    let navRows = [];

    let lastUrl =
        location.href;

    let rebuildTimer = null;

    let building = false;

    let scrollDirection =
        'down';

    const scrollState =
        new WeakMap();

    let chatScroller =
        null;

    let navManualUntil =
        0;


    // =========================================================
    // 分支 / 重试状态
    // =========================================================

    let branchResetPending =
        false;

    let branchCutIndex =
        -1;

    let branchResetTimer =
        null;


    // =========================================================
    // 工具函数
    // =========================================================

    function cleanText(text) {

        return (text || '')
            .replace(/\s+/g, ' ')
            .trim();

    }


    function shortText(
        text,
        max = TITLE_LENGTH
    ) {

        text =
            cleanText(text);


        if (
            text.length <= max
        ) {
            return text;
        }


        return (
            text.slice(0, max) +
            '…'
        );

    }


    function escapeHtml(text) {

        return String(text)
            .replace(
                /[&<>"']/g,
                char => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#039;'
                }[char])
            );

    }


    function isDark() {

        return (
            document.documentElement
                .classList
                .contains('dark')
            ||
            window.matchMedia(
                '(prefers-color-scheme: dark)'
            ).matches
        );

    }


    // =========================================================
    // 获取用户消息
    // =========================================================

    function getMessageElements() {

        let list = [
            ...document.querySelectorAll(
                '[data-search-result-target]'
            )
        ];


        list =
            list.filter(
                el => {

                    if (
                        !el.isConnected
                    ) {
                        return false;
                    }


                    // 排除脚本自身
                    if (
                        el.closest(
                            `#${NAV_ID}`
                        )
                        ||
                        el.closest(
                            `#${TIP_ID}`
                        )
                    ) {
                        return false;
                    }


                    // 排除助手消息内部
                    if (
                        el.closest(
                            '[data-markdown-text-style="assistant-message"]'
                        )
                    ) {
                        return false;
                    }


                    // 排除包含助手回答的大容器
                    if (
                        el.querySelector(
                            '[data-markdown-text-style="assistant-message"]'
                        )
                    ) {
                        return false;
                    }


                    return (
                        cleanText(
                            el.innerText
                        ).length > 0
                    );

                }
            );


        // 去掉嵌套重复节点
        list =
            list.filter(
                el => {

                    return !list.some(
                        other => {

                            if (
                                other === el
                            ) {
                                return false;
                            }


                            return other.contains(
                                el
                            );

                        }
                    );

                }
            );


        return list;

    }


    // =========================================================
    // 消息 ID
    // =========================================================

    function makeMessageId(
        element,
        text
    ) {

        const parent =
            element.closest(
                '[data-chatgpt-selection-message-id]'
            );


        const realId =
            parent?.getAttribute(
                'data-chatgpt-selection-message-id'
            );


        if (realId) {

            return (
                'id:' +
                realId
            );

        }


        // fallback：文本 hash
        let hash =
            2166136261;


        for (
            let i = 0;
            i < text.length;
            i++
        ) {

            hash ^=
                text.charCodeAt(i);


            hash +=
                (
                    (hash << 1) +
                    (hash << 4) +
                    (hash << 7) +
                    (hash << 8) +
                    (hash << 24)
                );

        }


        return (
            'text:' +
            (hash >>> 0)
                .toString(36)
        );

    }


    // =========================================================
    // 查找实际聊天滚动容器
    // =========================================================

    function findScrollContainer(
        element
    ) {

        let node =
            element?.parentElement;


        while (
            node &&
            node !== document.body
        ) {

            const style =
                getComputedStyle(node);


            if (
                (
                    style.overflowY === 'auto'
                    ||
                    style.overflowY === 'scroll'
                )
                &&
                node.scrollHeight >
                node.clientHeight + 100
            ) {

                return node;

            }


            node =
                node.parentElement;

        }


        return (
            document.scrollingElement
            ||
            document.documentElement
        );

    }


    // =========================================================
    // 消息绝对位置
    // =========================================================

    function getMessagePosition(
        element
    ) {

        if (
            !element ||
            !element.isConnected
        ) {
            return null;
        }


        const scroller =
            findScrollContainer(
                element
            );


        if (
            !chatScroller &&
            scroller
        ) {

            chatScroller =
                scroller;

        }


        const elementRect =
            element.getBoundingClientRect();


        if (
            scroller === document.scrollingElement
            ||
            scroller === document.documentElement
            ||
            scroller === document.body
        ) {

            return (
                window.scrollY +
                elementRect.top
            );

        }


        const scrollRect =
            scroller
                .getBoundingClientRect();


        return (
            scroller.scrollTop +
            elementRect.top -
            scrollRect.top
        );

    }


    // =========================================================
    // 当前 DOM 中的消息
    // =========================================================

    function getLiveRecords() {

        return getMessageElements()
            .map(
                element => {

                    const text =
                        cleanText(
                            element.innerText
                        );


                    return {

                        id:
                            makeMessageId(
                                element,
                                text
                            ),

                        text,

                        el:
                            element,

                        pos:
                            getMessagePosition(
                                element
                            )

                    };

                }
            );

    }


    // =========================================================
    // 查找消息
    // =========================================================

    function findMessageIndex(
        id
    ) {

        return messages.findIndex(
            item =>
                item.id === id
        );

    }


    // =========================================================
    // 合并当前 DOM 消息
    // =========================================================

    function mergeMessages() {

        const live =
            getLiveRecords();


        if (
            !live.length
        ) {
            return;
        }


        // ---------------------------------------------
        // 更新已经存在的消息
        // ---------------------------------------------

        for (
            const record
            of live
        ) {

            const index =
                findMessageIndex(
                    record.id
                );


            if (
                index >= 0
            ) {

                messages[index].el =
                    record.el;

                messages[index].text =
                    record.text;

                messages[index].pos =
                    record.pos;

            }

        }


        // ---------------------------------------------
        // 插入未知消息
        // ---------------------------------------------

        for (
            let i = 0;
            i < live.length;
            i++
        ) {

            const record =
                live[i];


            if (
                findMessageIndex(
                    record.id
                ) >= 0
            ) {
                continue;
            }


            // 找前面的已知锚点
            let previousIndex =
                -1;


            for (
                let p = i - 1;
                p >= 0;
                p--
            ) {

                const index =
                    findMessageIndex(
                        live[p].id
                    );


                if (
                    index >= 0
                ) {

                    previousIndex =
                        index;

                    break;

                }

            }


            // 找后面的已知锚点
            let nextIndex =
                -1;


            for (
                let n = i + 1;
                n < live.length;
                n++
            ) {

                const index =
                    findMessageIndex(
                        live[n].id
                    );


                if (
                    index >= 0
                ) {

                    nextIndex =
                        index;

                    break;

                }

            }


            if (
                previousIndex >= 0
            ) {

                messages.splice(
                    previousIndex + 1,
                    0,
                    record
                );


                continue;

            }


            if (
                nextIndex >= 0
            ) {

                messages.splice(
                    nextIndex,
                    0,
                    record
                );


                continue;

            }


            // 当前 DOM 和已有索引完全没有交集时，
            // 才根据滚动方向兜底
            if (
                scrollDirection === 'up'
            ) {

                messages.unshift(
                    record
                );

            }
            else {

                messages.push(
                    record
                );

            }

        }


        // ---------------------------------------------
        // 用真实位置辅助排序
        // ---------------------------------------------

        messages.sort(
            (
                a,
                b
            ) => {

                if (
                    Number.isFinite(a.pos)
                    &&
                    Number.isFinite(b.pos)
                ) {

                    return (
                        a.pos -
                        b.pos
                    );

                }


                return 0;

            }
        );


        // ---------------------------------------------
        // 去重
        // ---------------------------------------------

        const seen =
            new Set();


        messages =
            messages.filter(
                item => {

                    if (
                        seen.has(
                            item.id
                        )
                    ) {
                        return false;
                    }


                    seen.add(
                        item.id
                    );


                    return true;

                }
            );

    }


    // =========================================================
    // 找某条消息当前对应的真实 DOM
    // =========================================================

    function findLiveElement(
        item
    ) {

        if (
            item.el &&
            item.el.isConnected
        ) {

            return item.el;

        }


        const elements =
            getMessageElements();


        // 优先真实消息 ID
        if (
            item.id.startsWith(
                'id:'
            )
        ) {

            const realId =
                item.id.slice(3);


            for (
                const element
                of elements
            ) {

                const parent =
                    element.closest(
                        '[data-chatgpt-selection-message-id]'
                    );


                if (
                    parent?.getAttribute(
                        'data-chatgpt-selection-message-id'
                    )
                    === realId
                ) {

                    item.el =
                        element;


                    item.pos =
                        getMessagePosition(
                            element
                        );


                    return element;

                }

            }

        }


        // fallback：完整文字
        const target =
            elements.find(
                element =>
                    cleanText(
                        element.innerText
                    )
                    === item.text
            );


        if (target) {

            item.el =
                target;


            item.pos =
                getMessagePosition(
                    target
                );


            return target;

        }


        return null;

    }


    // =========================================================
    // 当前阅读消息索引
    // =========================================================

    function getCurrentIndex() {

        if (
            !messages.length
        ) {
            return -1;
        }


        const targetY =
            window.innerHeight *
            ACTIVE_VIEWPORT_RATIO;


        let bestIndex =
            -1;

        let bestDistance =
            Infinity;


        messages.forEach(
            (
                item,
                index
            ) => {

                const element =
                    findLiveElement(
                        item
                    );


                if (
                    !element ||
                    !element.isConnected
                ) {
                    return;
                }


                const rect =
                    element
                        .getBoundingClientRect();


                const y =
                    rect.top +
                    Math.min(
                        rect.height / 2,
                        80
                    );


                const distance =
                    Math.abs(
                        y -
                        targetY
                    );


                if (
                    distance <
                    bestDistance
                ) {

                    bestDistance =
                        distance;

                    bestIndex =
                        index;

                }

            }
        );


        return bestIndex;

    }


    // =========================================================
    // Tooltip
    // =========================================================

    function hideTooltip() {

        document
            .getElementById(
                TIP_ID
            )
            ?.remove();

    }


    function showTooltip(
        row,
        item,
        index
    ) {

        hideTooltip();


        const tip =
            document.createElement(
                'div'
            );


        tip.id =
            TIP_ID;


        Object.assign(
            tip.style,
            {

                position:
                    'fixed',

                zIndex:
                    '2147483647',

                maxWidth:
                    '440px',

                minWidth:
                    '220px',

                padding:
                    '10px 12px',

                borderRadius:
                    '10px',

                fontSize:
                    '12px',

                lineHeight:
                    '1.5',

                pointerEvents:
                    'none',

                color:
                    isDark()
                        ? '#eee'
                        : '#222',

                background:
                    isDark()
                        ? 'rgba(35,35,35,.97)'
                        : 'rgba(255,255,255,.98)',

                border:
                    isDark()
                        ? '1px solid rgba(255,255,255,.08)'
                        : '1px solid rgba(0,0,0,.08)',

                boxShadow:
                    '0 4px 20px rgba(0,0,0,.16)'

            }
        );


        tip.innerHTML =
            `
            <div style="
                opacity:.55;
                font-size:11px;
                margin-bottom:5px;
            ">
                第 ${index + 1} 条
            </div>

            <div>
                ${escapeHtml(item.text)}
            </div>
            `;


        document.body
            .appendChild(
                tip
            );


        const rect =
            row.getBoundingClientRect();


        const tipRect =
            tip.getBoundingClientRect();


        let left =
            rect.left -
            tipRect.width -
            12;


        if (
            left < 10
        ) {

            left =
                rect.right +
                12;

        }


        let top =
            rect.top +
            rect.height / 2;


        const half =
            tipRect.height / 2;


        top =
            Math.max(
                half + 10,
                Math.min(
                    window.innerHeight -
                    half -
                    10,
                    top
                )
            );


        tip.style.left =
            left + 'px';


        tip.style.top =
            top + 'px';


        tip.style.transform =
            'translateY(-50%)';

    }


    // =========================================================
    // 点击导航
    // =========================================================

    async function jumpToMessage(
        item
    ) {

        let target =
            findLiveElement(
                item
            );


        if (target) {

            target.scrollIntoView({

                behavior:
                    'smooth',

                block:
                    'center'

            });


            return;

        }


        // DOM 已经被虚拟列表卸载，
        // 用以前的位置粗定位
        if (
            Number.isFinite(
                item.pos
            )
        ) {

            if (
                !chatScroller
            ) {

                const current =
                    getMessageElements()[0];


                if (current) {

                    chatScroller =
                        findScrollContainer(
                            current
                        );

                }

            }


            const scroller =
                chatScroller;


            if (scroller) {

                const viewport =
                    scroller.clientHeight
                    ||
                    window.innerHeight;


                const destination =
                    Math.max(
                        0,
                        item.pos -
                        viewport * 0.35
                    );


                if (
                    scroller ===
                    document.scrollingElement
                    ||
                    scroller ===
                    document.documentElement
                    ||
                    scroller ===
                    document.body
                ) {

                    window.scrollTo({

                        top:
                            destination,

                        behavior:
                            'smooth'

                    });

                }
                else {

                    scroller.scrollTo({

                        top:
                            destination,

                        behavior:
                            'smooth'

                    });

                }


                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            650
                        )
                );


                mergeMessages();


                target =
                    findLiveElement(
                        item
                    );


                if (target) {

                    target.scrollIntoView({

                        behavior:
                            'smooth',

                        block:
                            'center'

                    });

                }

            }

        }

    }


    // =========================================================
    // 创建导航
    // =========================================================

    function getNavigator() {

        let nav =
            document.getElementById(
                NAV_ID
            );


        if (!nav) {

            nav =
                document.createElement(
                    'div'
                );


            nav.id =
                NAV_ID;


            document.body
                .appendChild(
                    nav
                );

        }


        Object.assign(
            nav.style,
            {

                position:
                    'fixed',

                right:
                    '12px',

                top:
                    '50%',

                transform:
                    'translateY(-50%)',

                width:
                    NAV_WIDTH +
                    'px',

                maxHeight:
                    MAX_NAV_HEIGHT,

                overflowY:
                    'auto',

                overflowX:
                    'hidden',

                zIndex:
                    '2147483646',

                padding:
                    '8px',

                boxSizing:
                    'border-box',

                borderRadius:
                    '12px',

                display:
                    'flex',

                flexDirection:
                    'column',

                gap:
                    '0',

                background:
                    isDark()
                        ? 'rgba(32,32,32,.82)'
                        : 'rgba(255,255,255,.92)',

                backdropFilter:
                    'blur(10px)',

                border:
                    isDark()
                        ? '1px solid rgba(255,255,255,.07)'
                        : '1px solid rgba(0,0,0,.07)',

                boxShadow:
                    '0 3px 18px rgba(0,0,0,.15)',

                scrollbarWidth:
                    'thin'

            }
        );


        nav.onwheel =
            () => {

                navManualUntil =
                    Date.now() +
                    NAV_MANUAL_PAUSE;

            };


        nav.onmousedown =
            () => {

                navManualUntil =
                    Date.now() +
                    NAV_MANUAL_PAUSE;

            };


        return nav;

    }


    // =========================================================
    // 构建导航
    // =========================================================

    function buildNavigator() {

        if (
            building
        ) {
            return;
        }


        building =
            true;


        try {

            mergeMessages();


            if (
                !messages.length
            ) {

                document
                    .getElementById(
                        NAV_ID
                    )
                    ?.remove();


                navRows = [];

                return;

            }


            const nav =
                getNavigator();


            const oldScrollTop =
                nav.scrollTop;


            nav.innerHTML =
                '';


            navRows = [];


            messages.forEach(
                (
                    item,
                    index
                ) => {

                    const row =
                        document.createElement(
                            'div'
                        );


                    Object.assign(
                        row.style,
                        {

                            width:
                                '100%',

                            height:
                                ROW_HEIGHT +
                                'px',

                            minHeight:
                                ROW_HEIGHT +
                                'px',

                            display:
                                'flex',

                            alignItems:
                                'center',

                            justifyContent:
                                'flex-end',

                            boxSizing:
                                'border-box',

                            cursor:
                                'pointer'

                        }
                    );


                    // -----------------------------------------
                    // 文字
                    // -----------------------------------------

                    const label =
                        document.createElement(
                            'div'
                        );


                    label.textContent =
                        shortText(
                            item.text
                        );


                    label.title =
                        item.text;


                    Object.assign(
                        label.style,
                        {

                            flex:
                                '1 1 auto',

                            minWidth:
                                '0',

                            overflow:
                                'hidden',

                            whiteSpace:
                                'nowrap',

                            textOverflow:
                                'ellipsis',

                            textAlign:
                                'right',

                            fontSize:
                                FONT_SIZE +
                                'px',

                            lineHeight:
                                ROW_HEIGHT +
                                'px',

                            color:
                                isDark()
                                    ? '#aaa'
                                    : '#777',

                            userSelect:
                                'none'

                        }
                    );


                    // -----------------------------------------
                    // 固定横线区域
                    // -----------------------------------------

                    const lineBox =
                        document.createElement(
                            'div'
                        );


                    Object.assign(
                        lineBox.style,
                        {

                            width:
                                LINE_BOX_WIDTH +
                                'px',

                            minWidth:
                                LINE_BOX_WIDTH +
                                'px',

                            maxWidth:
                                LINE_BOX_WIDTH +
                                'px',

                            flex:
                                '0 0 ' +
                                LINE_BOX_WIDTH +
                                'px',

                            marginLeft:
                                '6px',

                            display:
                                'flex',

                            justifyContent:
                                'flex-start',

                            alignItems:
                                'center',

                            overflow:
                                'visible'

                        }
                    );


                    // -----------------------------------------
                    // 实际横线
                    //
                    // width 永远固定 10px
                    // 当前项通过 scaleX(2) 视觉放大
                    // -----------------------------------------

                    const line =
                        document.createElement(
                            'div'
                        );


                    Object.assign(
                        line.style,
                        {

                            width:
                                NORMAL_LINE_WIDTH +
                                'px',

                            minWidth:
                                NORMAL_LINE_WIDTH +
                                'px',

                            maxWidth:
                                NORMAL_LINE_WIDTH +
                                'px',

                            height:
                                '2px',

                            borderRadius:
                                '99px',

                            background:
                                isDark()
                                    ? '#777'
                                    : '#999',

                            opacity:
                                '.7',

                            transform:
                                'scaleX(1)',

                            transformOrigin:
                                'left center',

                            willChange:
                                'transform',

                            transition:
                                [
                                    'transform .12s ease',
                                    'height .12s ease',
                                    'background .12s ease',
                                    'opacity .12s ease'
                                ].join(',')

                        }
                    );


                    lineBox.appendChild(
                        line
                    );


                    row.appendChild(
                        label
                    );


                    row.appendChild(
                        lineBox
                    );


                    // 点击
                    row.onclick =
                        event => {

                            event.stopPropagation();

                            hideTooltip();

                            jumpToMessage(
                                item
                            );

                        };


                    // hover 仅显示全文
                    row.onmouseenter =
                        () => {

                            showTooltip(
                                row,
                                item,
                                index
                            );

                        };


                    row.onmouseleave =
                        () => {

                            hideTooltip();

                        };


                    nav.appendChild(
                        row
                    );


                    navRows.push({

                        row,

                        label,

                        line,

                        lineBox,

                        item

                    });

                }
            );


            if (
                Date.now() <
                navManualUntil
            ) {

                nav.scrollTop =
                    oldScrollTop;

            }


            updateNavigator();

        }

        finally {

            building =
                false;

        }

    }


    // =========================================================
    // 当前项高亮
    // =========================================================

    function updateNavigator() {

        if (
            !navRows.length
        ) {
            return;
        }


        const active =
            getCurrentIndex();


        navRows.forEach(
            (
                item,
                index
            ) => {

                if (
                    index === active
                ) {

                    item.label.style.color =
                        '#4f6df5';


                    item.label.style.fontWeight =
                        '500';


                    item.line.style.background =
                        '#4f6df5';


                    // 不改 width，只缩放
                    item.line.style.transform =
                        `scaleX(${ACTIVE_LINE_SCALE})`;


                    item.line.style.height =
                        '3px';


                    item.line.style.opacity =
                        '1';

                }

                else {

                    item.label.style.color =
                        isDark()
                            ? '#aaa'
                            : '#777';


                    item.label.style.fontWeight =
                        '400';


                    item.line.style.background =
                        isDark()
                            ? '#777'
                            : '#999';


                    item.line.style.transform =
                        'scaleX(1)';


                    item.line.style.height =
                        '2px';


                    item.line.style.opacity =
                        '.7';

                }

            }
        );


        // 自动让当前项位于导航中间
        if (
            active >= 0
            &&
            navRows[active]
            &&
            Date.now() >
                navManualUntil
        ) {

            const nav =
                document.getElementById(
                    NAV_ID
                );


            const row =
                navRows[active]
                    .row;


            if (
                nav &&
                row
            ) {

                const target =
                    row.offsetTop -
                    nav.clientHeight / 2 +
                    ROW_HEIGHT / 2;


                const safeTarget =
                    Math.max(
                        0,
                        target
                    );


                // 避免几像素变化导致持续抖动
                if (
                    Math.abs(
                        nav.scrollTop -
                        safeTarget
                    ) >
                    ROW_HEIGHT
                ) {

                    nav.scrollTop =
                        safeTarget;

                }

            }

        }

    }


    // =========================================================
    // 重试 / 重新生成 / 分支切换处理
    // =========================================================

    function scheduleBranchReset() {

        const current =
            getCurrentIndex();


        if (
            current < 0
        ) {
            return;
        }


        /*
         * 这里保存“分叉位置”。
         *
         * 重试通常发生在当前助手回答附近，
         * 它之后的旧分支用户消息应该失效。
         */

        branchCutIndex =
            current;


        branchResetPending =
            true;


        clearTimeout(
            branchResetTimer
        );


        branchResetTimer =
            setTimeout(
                applyBranchReset,
                BRANCH_RESET_DELAY
            );

    }


    function applyBranchReset() {

        if (
            !branchResetPending
        ) {
            return;
        }


        branchResetPending =
            false;


        if (
            branchCutIndex < 0
        ) {
            return;
        }


        /*
         * 保留分叉点及之前的用户消息，
         * 删除之后旧分支留下来的缓存。
         */

        messages =
            messages.slice(
                0,
                branchCutIndex + 1
            );


        branchCutIndex =
            -1;


        /*
         * ChatGPT 完成重试后，
         * 当前 DOM 已经是新分支。
         */

        mergeMessages();


        buildNavigator();

    }


    // =========================================================
    // 检测重试 / 重新生成按钮
    // =========================================================

    document.addEventListener(
        'click',
        event => {

            const rawTarget =
                event.target;


            if (
                !(rawTarget instanceof Element)
            ) {
                return;
            }


            const button =
                rawTarget.closest(
                    'button,[role="button"]'
                );


            if (!button) {
                return;
            }


            /*
             * 同时读取：
             * innerText
             * textContent
             * aria-label
             * title
             */

            const description =
                cleanText(
                    [
                        button.innerText,
                        button.textContent,
                        button.getAttribute(
                            'aria-label'
                        ),
                        button.getAttribute(
                            'title'
                        )
                    ]
                    .filter(Boolean)
                    .join(' ')
                )
                .toLowerCase();


            const isBranchAction =

                description.includes(
                    '重新生成'
                )

                ||

                description.includes(
                    '重试'
                )

                ||

                description.includes(
                    'regenerate'
                )

                ||

                description.includes(
                    'retry'
                )

                ||

                description.includes(
                    '上一回答'
                )

                ||

                description.includes(
                    '下一回答'
                )

                ||

                description.includes(
                    '上一回复'
                )

                ||

                description.includes(
                    '下一回复'
                )

                ||

                description.includes(
                    'previous response'
                )

                ||

                description.includes(
                    'next response'
                )

                ||

                description.includes(
                    'previous answer'
                )

                ||

                description.includes(
                    'next answer'
                );


            if (
                isBranchAction
            ) {

                scheduleBranchReset();

            }

        },
        true
    );


    // =========================================================
    // 防抖构建
    // =========================================================

    function scheduleBuild(
        delay = 350
    ) {

        clearTimeout(
            rebuildTimer
        );


        rebuildTimer =
            setTimeout(
                buildNavigator,
                delay
            );

    }


    // =========================================================
    // DOM Observer
    // =========================================================

    const observer =
        new MutationObserver(
            mutations => {

                if (
                    building
                ) {
                    return;
                }


                let useful =
                    false;


                for (
                    const mutation
                    of mutations
                ) {

                    const target =
                        mutation.target;


                    if (
                        target instanceof Element
                        &&
                        (
                            target.closest(
                                `#${NAV_ID}`
                            )
                            ||
                            target.closest(
                                `#${TIP_ID}`
                            )
                        )
                    ) {

                        continue;

                    }


                    useful =
                        true;

                    break;

                }


                if (
                    useful
                ) {

                    scheduleBuild(
                        300
                    );

                }

            }
        );


    observer.observe(
        document.body,
        {

            childList:
                true,

            subtree:
                true

        }
    );


    // =========================================================
    // 滚动方向检测
    // =========================================================

    document.addEventListener(
        'scroll',
        event => {

            const target =
                event.target;


            // 导航自身滚动
            if (
                target instanceof Element
                &&
                (
                    target.id === NAV_ID
                    ||
                    target.closest(
                        `#${NAV_ID}`
                    )
                )
            ) {

                navManualUntil =
                    Date.now() +
                    NAV_MANUAL_PAUSE;


                return;

            }


            let scrollTop =
                0;


            if (
                target === document
                ||
                target === document.documentElement
                ||
                target === document.body
            ) {

                scrollTop =
                    window.scrollY
                    ||
                    document.documentElement
                        .scrollTop
                    ||
                    0;

            }

            else if (
                target instanceof Element
            ) {

                scrollTop =
                    target.scrollTop;


                if (
                    target.scrollHeight >
                    target.clientHeight + 100
                ) {

                    chatScroller =
                        target;

                }

            }


            const key =
                target instanceof Object
                    ? target
                    : document;


            const previous =
                scrollState.get(
                    key
                );


            if (
                typeof previous ===
                'number'
            ) {

                if (
                    scrollTop <
                    previous
                ) {

                    scrollDirection =
                        'up';

                }

                else if (
                    scrollTop >
                    previous
                ) {

                    scrollDirection =
                        'down';

                }

            }


            if (
                key instanceof Object
            ) {

                scrollState.set(
                    key,
                    scrollTop
                );

            }


            scheduleBuild(
                180
            );


            requestAnimationFrame(
                updateNavigator
            );

        },
        {

            capture:
                true,

            passive:
                true

        }
    );


    // =========================================================
    // 切换不同聊天
    // =========================================================

    setInterval(
        () => {

            if (
                location.href ===
                lastUrl
            ) {
                return;
            }


            lastUrl =
                location.href;


            messages = [];

            navRows = [];

            chatScroller =
                null;

            scrollDirection =
                'down';

            navManualUntil =
                0;


            branchResetPending =
                false;

            branchCutIndex =
                -1;


            clearTimeout(
                branchResetTimer
            );


            document
                .getElementById(
                    NAV_ID
                )
                ?.remove();


            document
                .getElementById(
                    TIP_ID
                )
                ?.remove();


            setTimeout(
                buildNavigator,
                1000
            );

        },
        600
    );


    // =========================================================
    // 手动刷新
    //
    // 控制台执行：
    //
    // window.chatgptNavRefresh()
    //
    // =========================================================

    window.chatgptNavRefresh =
        function () {

            mergeMessages();

            buildNavigator();

        };


    // =========================================================
    // 手动强制清理当前分支后面的导航
    //
    // 如果某次 ChatGPT UI 改版后，
    // 自动识别“重新生成”按钮失败，
    // 可以在控制台执行：
    //
    // window.chatgptNavResetBranch()
    //
    // =========================================================

    window.chatgptNavResetBranch =
        function () {

            scheduleBranchReset();

        };


    // =========================================================
    // 初始化
    // =========================================================

    setTimeout(
        buildNavigator,
        1200
    );


})();
