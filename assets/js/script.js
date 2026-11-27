/* mjmaher: a tiny terminal. No dependencies. */
(() => {
    'use strict';

    const $ = (selector) => document.querySelector(selector);
    const root = document.documentElement;
    const log = $('#log');
    const form = $('#prompt');
    const input = $('#input');
    const menu = $('#menu');
    const keys = $('#keys');
    const hint = $('#hint');
    const themeMeta = $('meta[name="theme-color"]');
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = matchMedia('(pointer: fine)').matches;
    const scrollBehavior = reduceMotion ? 'auto' : 'smooth';
    const baseTitle = document.title;

    const COMMANDS = [
        ['about', 'who I am'],
        ['news', "what's new"],
        ['work', "things I've built"],
        ['papers', 'research & publications'],
        ['experience', "where I've been"],
        ['contact', 'say hi'],
        ['theme', 'toggle light / dark'],
        ['clear', 'clear the screen'],
        ['help', 'list commands'],
    ];
    const ALIASES = Object.assign(Object.create(null), {
        me: 'about', whois: 'about', projects: 'work', research: 'papers', publications: 'papers',
        pubs: 'papers', cv: 'experience', resume: 'experience', jobs: 'experience', hire: 'contact',
        email: 'contact', blog: 'news', exit: 'exit', quit: 'exit',
    });
    const SECTIONS = ['about', 'news', 'work', 'papers', 'experience', 'contact'];
    const VERBS = ['Distilling', 'Quantizing', 'Predistorting', 'Backpropagating', 'Pruning', 'Compressing',
        'Convolving', 'Fine-tuning', 'Benchmarking', 'Tokenizing', 'Annealing', 'Overfitting'];
    const GLYPHS = ['·', '✢', '✶', '✻', '✽', '✻', '✶', '✢'];
    const LS = [['about.md', 'about'], ['news.log', 'news'], ['projects/', 'work'], ['papers.bib', 'papers'],
        ['todo.md', 'experience'], ['contact.vcf', 'contact']]
        .map(([file, cmd]) => `<a href="#${cmd}" data-run="/${cmd}">${file}</a>`).join('');

    // Lift the pre-rendered transcript into command templates.
    const pages = Object.create(null);
    log.querySelectorAll('.turn[data-cmd]').forEach((turn) => {
        pages[turn.dataset.cmd] = turn.querySelector('.out').innerHTML;
        turn.remove();
    });

    const seen = new Set();
    const hist = [];
    let histIndex = 0;
    let matches = [];
    let selected = 0;
    let busy = null;
    let typing = null;

    const resolve = (name) => ALIASES[name] || name;
    const isKnown = (name) => name in ALIASES || COMMANDS.some(([n]) => n === name);

    /* ---------- transcript ---------- */

    function addTurn(text) {
        const turn = document.createElement('section');
        turn.className = 'turn';
        const cmd = document.createElement('p');
        cmd.className = 'cmd';
        cmd.textContent = text;
        const out = document.createElement('div');
        out.className = 'out';
        turn.append(cmd, out);
        log.append(turn);
        return out;
    }

    // `html` is only ever passed for strings written in this file, never for visitor input.
    function reply(out, text, cls = 'res', html = false) {
        const line = document.createElement('div');
        line.className = cls;
        if (html) line.innerHTML = text;
        else line.textContent = text;
        out.append(line);
    }

    function reveal(out, initial) {
        if (initial) return;
        const turn = out.parentElement;
        const fits = turn.offsetHeight + form.offsetHeight + hint.offsetHeight + 64 < innerHeight;
        (fits ? hint : turn).scrollIntoView({ block: fits ? 'nearest' : 'start', behavior: scrollBehavior });
    }

    function think(out) {
        if (reduceMotion) return Promise.resolve(true);
        return new Promise((done) => {
            const line = document.createElement('p');
            line.className = 'spinner';
            line.setAttribute('aria-hidden', 'true');
            line.innerHTML = `<span class="g">·</span><span class="verb">${VERBS[Math.random() * VERBS.length | 0]}…</span> <span class="meta">(0.0s · esc to interrupt)</span>`;
            out.append(line);
            const glyph = line.querySelector('.g');
            const meta = line.querySelector('.meta');
            const start = performance.now();
            let frame = 0;
            const tick = setInterval(() => {
                glyph.textContent = GLYPHS[++frame % GLYPHS.length];
                meta.textContent = `(${((performance.now() - start) / 1000).toFixed(1)}s · esc to interrupt)`;
            }, 90);
            const finish = (ok) => {
                clearInterval(tick);
                clearTimeout(timer);
                line.remove();
                busy = null;
                done(ok);
            };
            const timer = setTimeout(finish, 600 + Math.random() * 500, true);
            busy = { cancel: () => finish(false) };
        });
    }

    async function run(raw, { initial = false } = {}) {
        const text = raw.trim();
        if (!text || busy) return;
        if (typing) stopTyping();
        remember(text);
        closeMenu();
        keys.hidden = true;

        const [first, ...args] = text.split(/\s+/);
        const head = first.toLowerCase();
        let name = head.startsWith('/') ? head.slice(1) : '';
        if (!name && isKnown(head)) name = head; // "news" works as well as "/news"

        if (name === 'clear') {
            log.replaceChildren();
            setRoute('');
            return;
        }

        const out = addTurn(text);
        const target = resolve(name);

        if (target in pages) {
            reveal(out, initial);
            if (!(await think(out))) {
                reply(out, 'Interrupted by user', 'res err');
                return reveal(out);
            }
            if (name === 'hire') reply(out, 'Excellent judgment. Here’s how to reach me:', 'say');
            out.insertAdjacentHTML('beforeend', pages[target]);
            out.querySelectorAll('.px img').forEach(pixelate);
            seen.add(target);
            setRoute(target);
            updatePlaceholder();
        } else if (target === 'theme') {
            setTheme(args[0]);
            reply(out, `Theme set to ${root.dataset.theme}`);
        } else if (target === 'help') {
            out.append(helpBlock());
        } else if (target === 'exit') {
            reply(out, 'There’s no exit here, only <a href="#contact" data-run="/contact">/contact</a>.', 'res', true);
        } else if (name) {
            reply(out, `Unknown command: /${name} · try /help`, 'res err');
        } else {
            await chat(out, head);
        }
        reveal(out, initial);
    }

    async function chat(out, text) {
        if (text === 'ls') return reply(out, LS, 'res ls', true);
        if (text === 'whoami') return reply(out, 'visitor');
        if (text === 'pwd') return reply(out, '/home/javad/toronto');
        if (text === 'sudo') return reply(out, 'visitor is not in the sudoers file. This incident will be reported.', 'res err');
        if (!(await think(out))) return reply(out, 'Interrupted by user', 'res err');
        const hello = /^(hi|hey|hello|yo|salam|سلام)$/.test(text);
        reply(out, hello
            ? 'Hi there! I’m a static page, so I only speak slash commands. Start with <a href="#about" data-run="/about">/about</a>.'
            : 'I’m a static page, so I only speak slash commands. Try <a href="#" data-run="/help">/help</a>, or <a href="#contact" data-run="/contact">/contact</a> to ask the real Javad.',
        'say', true);
    }

    function helpBlock() {
        const res = document.createElement('div');
        res.className = 'res';
        res.innerHTML = '<dl class="kv">'
            + COMMANDS.map(([n, d]) => `<dt><a href="#${n}" data-run="/${n}">/${n}</a></dt><dd>${d}</dd>`).join('')
            + '</dl><p class="dim">↑↓ history · tab complete · esc clear · ctrl+l clear screen</p>';
        return res;
    }

    // Shows the portrait the way a terminal would: a 34×34 grid of posterized cells.
    function pixelate(img) {
        const N = 34;
        const draw = () => {
            if (!img.naturalWidth) return;
            const mid = document.createElement('canvas'); // two-step downscale keeps cells clean
            mid.width = mid.height = N * 4;
            mid.getContext('2d').drawImage(img, 0, 0, N * 4, N * 4);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = N;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(mid, 0, 0, N, N);
            try {
                const data = ctx.getImageData(0, 0, N, N);
                for (let i = 0; i < data.data.length; i += 4) {
                    for (let c = 0; c < 3; c++) data.data[i + c] = Math.round(data.data[i + c] / 36) * 36;
                }
                ctx.putImageData(data, 0, 0);
            } catch (_) { /* file:// taints the canvas; the plain pixel grid still looks right */ }
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', img.alt);
            img.replaceWith(canvas);
        };
        if (img.complete && img.naturalWidth) draw();
        else img.addEventListener('load', draw, { once: true });
    }

    /* ---------- autocomplete menu ---------- */

    function updateMenu({ scroll = true } = {}) {
        const value = input.value.toLowerCase();
        if (!value.startsWith('/') || /\s/.test(value)) return closeMenu();
        const q = value.slice(1);
        matches = [
            ...COMMANDS.filter(([n]) => n.startsWith(q)),
            ...COMMANDS.filter(([n, d]) => !n.startsWith(q) && (n.includes(q) || d.includes(q))),
        ];
        if (!matches.length) return closeMenu();
        selected = Math.min(selected, matches.length - 1);
        menu.innerHTML = matches.map(([n, d], i) =>
            `<li id="opt-${n}" role="option" aria-selected="${i === selected}" data-run="/${n}"><span>/${n}</span><span>${d}</span></li>`
        ).join('');
        menu.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('aria-activedescendant', `opt-${matches[selected][0]}`);
        if (scroll) hint.scrollIntoView({ block: 'nearest', behavior: scrollBehavior });
    }

    function closeMenu() {
        menu.hidden = true;
        matches = [];
        selected = 0;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }

    /* ---------- history, theme, routing ---------- */

    function remember(text) {
        if (hist[hist.length - 1] !== text) hist.push(text);
        histIndex = hist.length;
    }

    function recall(step) {
        if (!hist.length) return;
        histIndex = Math.max(0, Math.min(hist.length, histIndex + step));
        input.value = hist[histIndex] || '';
        requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    }

    function updatePlaceholder() {
        const next = SECTIONS.find((s) => !seen.has(s));
        input.placeholder = next ? `Try "/${next}"` : 'Type / for commands';
    }

    function setTheme(next) {
        if (next !== 'light' && next !== 'dark') next = root.dataset.theme === 'light' ? 'dark' : 'light';
        root.dataset.theme = next;
        try { localStorage.setItem('theme', next); } catch (_) { /* private mode */ }
        syncThemeColor();
    }

    function syncThemeColor() {
        themeMeta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
    }

    function setRoute(name) {
        history.replaceState(null, '', name ? `#${name}` : location.pathname + location.search);
        document.title = name ? `/${name} · ${baseTitle}` : baseTitle;
    }

    function autotype(cmd) {
        if (reduceMotion) return run(cmd, { initial: true });
        let i = 0;
        const finish = () => {
            typing = null;
            input.value = '';
            closeMenu();
            run(cmd, { initial: true });
        };
        const step = () => {
            input.value = cmd.slice(0, ++i);
            selected = 0;
            updateMenu({ scroll: false });
            typing = setTimeout(i < cmd.length ? step : finish, i < cmd.length ? 80 : 380);
        };
        typing = setTimeout(step, 450);
    }

    function stopTyping() {
        clearTimeout(typing);
        typing = null;
        input.value = '';
        closeMenu();
    }

    function copy(button) {
        const flash = (msg) => {
            button.textContent = msg;
            setTimeout(() => { button.textContent = 'copy'; }, 1600);
        };
        if (!navigator.clipboard) return flash('copy failed');
        navigator.clipboard.writeText(button.dataset.copy).then(() => flash('copied ✓'), () => flash('copy failed'));
    }

    /* ---------- events ---------- */

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (busy) return;
        let value = input.value.trim();
        const exact = /^\/\S+$/.test(value) && isKnown(value.slice(1).toLowerCase());
        if (!menu.hidden && matches.length && !exact) value = `/${matches[selected][0]}`;
        input.value = '';
        closeMenu();
        run(value);
    });

    input.addEventListener('input', () => {
        selected = 0;
        keys.hidden = true;
        updateMenu();
    });

    input.addEventListener('keydown', (e) => {
        if (typing) stopTyping();
        const open = !menu.hidden;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            if (open) {
                selected = (selected + step + matches.length) % matches.length;
                updateMenu();
            } else {
                recall(step);
            }
        } else if (e.key === 'Tab' && open) {
            e.preventDefault();
            input.value = `/${matches[selected][0]}`;
            updateMenu();
        } else if (e.key === 'Escape') {
            if (busy) busy.cancel();
            else if (open) closeMenu();
            else if (!keys.hidden) keys.hidden = true;
            else input.value = '';
        } else if (e.key === '?' && !input.value) {
            e.preventDefault();
            keys.hidden = !keys.hidden;
        } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            run('/clear');
        }
    });

    // Typing anywhere on the page goes to the prompt.
    document.addEventListener('keydown', (e) => {
        if (e.target === input) return;
        if (e.key === 'Escape' && busy) return busy.cancel();
        if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
        if (e.target.closest && e.target.closest('input, textarea, select')) return;
        e.preventDefault();
        if (typing) stopTyping();
        input.focus({ preventScroll: true });
        if (e.key === '?' && !input.value) {
            keys.hidden = !keys.hidden;
            return;
        }
        input.value += e.key;
        selected = 0;
        updateMenu();
    });

    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-run], [data-copy], [data-slash]');
        if (target && target.hasAttribute('data-run')) {
            e.preventDefault();
            if (typing) stopTyping();
            input.value = '';
            closeMenu();
            run(target.dataset.run);
            if (finePointer) input.focus({ preventScroll: true });
        } else if (target && target.hasAttribute('data-copy')) {
            copy(target);
        } else if (target && target.hasAttribute('data-slash')) {
            if (typing) stopTyping();
            input.value = '/';
            input.focus();
            updateMenu();
        } else if (finePointer && !e.target.closest('a, button, input') && !String(getSelection())) {
            input.focus({ preventScroll: true });
        }
    });

    window.addEventListener('hashchange', () => {
        const name = location.hash.slice(1).toLowerCase();
        if (resolve(name) in pages) run(`/${name}`);
    });

    /* ---------- boot ---------- */

    const now = new Date();
    $('#ver').textContent = `v${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
    try {
        if (localStorage.getItem('visited')) $('#hi').textContent = 'Welcome back!';
        localStorage.setItem('visited', '1');
    } catch (_) { /* private mode */ }
    syncThemeColor();
    updatePlaceholder();
    if (finePointer) input.focus({ preventScroll: true });

    const start = location.hash.slice(1).toLowerCase();
    if (start && resolve(start) in pages) run(`/${start}`);
    else autotype('/about');
})();
