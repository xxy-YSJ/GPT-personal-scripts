// ==UserScript==
// @name         ChatGPT PgUp/PgDn Fix
// @namespace    chatgpt-pg-fix
// @version      1.0
// @description  Restore PageUp/PageDown scrolling on ChatGPT
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function isEditable(el) {
        if (!el) return false;

        const tag = el.tagName?.toLowerCase();

        return (
            tag === 'input' ||
            tag === 'textarea' ||
            tag === 'select' ||
            el.isContentEditable ||
            el.closest?.(
                'input, textarea, select, [contenteditable="true"], [role="textbox"]'
            )
        );
    }

    function findScroller() {
        const all = [
            document.scrollingElement,
            document.documentElement,
            document.body,
            ...document.querySelectorAll('*')
        ];

        let best = null;
        let bestArea = 0;

        for (const el of all) {
            if (!el) continue;

            const style = getComputedStyle(el);

            if (
                el.scrollHeight > el.clientHeight + 50 &&
                ['auto', 'scroll'].includes(style.overflowY)
            ) {
                const area = el.clientWidth * el.clientHeight;

                if (area > bestArea) {
                    best = el;
                    bestArea = area;
                }
            }
        }

        return best || document.scrollingElement;
    }

    window.addEventListener(
        'keydown',
        function (e) {
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            if (isEditable(document.activeElement)) return;

            if (e.key !== 'PageDown' && e.key !== 'PageUp') return;

            const scroller = findScroller();
            if (!scroller) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            const distance = Math.round(window.innerHeight * 0.85);

            scroller.scrollBy({
                top: e.key === 'PageDown' ? distance : -distance,
                behavior: 'smooth'
            });
        },
        true
    );
})();
