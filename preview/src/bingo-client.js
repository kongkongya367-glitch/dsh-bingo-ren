(function () {
  'use strict';

  if (window.__DSH_BINGO_LOADED__) return;
  window.__DSH_BINGO_LOADED__ = true;

  var VERSION = typeof window.__DSH_BINGO_VERSION__ === 'string' && window.__DSH_BINGO_VERSION__
    ? window.__DSH_BINGO_VERSION__
    : '0.1.0';
  var API = '/bingo';
  var CSS_URL = typeof window.__DSH_BINGO_CLIENT_CSS__ === 'string' && window.__DSH_BINGO_CLIENT_CSS__
    ? window.__DSH_BINGO_CLIENT_CSS__
    : API + '/client.css?v=' + encodeURIComponent(VERSION);
  var INITIAL_POSITION = window.__DSH_BINGO_POSITION__ === 'bottom-right' ? 'bottom-right' : 'bottom-left';
  var AUTO_DIALOG = window.__DSH_BINGO_NO_AUTO_DIALOG__ !== true;
  var DEFAULT_POLL = 4000;
  var MAX_RETRY = 30000;
  var REQUEST_TIMEOUT = 5000;
  var MANUAL_HINT_AFTER = 12000;
  var PANEL_PENDING_LIMIT = 4;
  var DIALOG_PENDING_LIMIT = 6;

  var ICON_SPARK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.4c.47 4.74 3.86 8.13 8.6 8.6-4.74.47-8.13 3.86-8.6 8.6-.47-4.74-3.86-8.13-8.6-8.6 4.74-.47 8.13-3.86 8.6-8.6Z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  var ICON_CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 5.2V8l1.9 1.3"/></svg>';

  var TEMPLATE = [
    '<button class="bingo-pill" data-el="pill" type="button" aria-label="Bingo：重启 DeepSeek Harness" aria-haspopup="dialog" aria-expanded="false">',
    '<span class="bingo-mark" aria-hidden="true">' + ICON_SPARK + '<span class="bingo-pill__spin"></span></span>',
    '<span class="bingo-pill__label">Bingo</span>',
    '<span class="bingo-pill__dot" aria-hidden="true"></span>',
    '</button>',
    '<section class="bingo-panel" data-el="panel" role="dialog" aria-modal="false" aria-labelledby="bingo-title" hidden>',
    '<header class="bingo-head">',
    '<span class="bingo-mark bingo-mark--sm" aria-hidden="true">' + ICON_SPARK + '</span>',
    '<span class="bingo-head__title" id="bingo-title">Bingo</span>',
    '<span class="bingo-version" data-el="version">v' + VERSION + '</span>',
    '<button class="bingo-iconbtn" data-el="close" type="button" aria-label="关闭面板">' + ICON_CLOSE + '</button>',
    '</header>',
    '<div class="bingo-status"><span class="bingo-dot" data-el="statusDot" aria-hidden="true"></span><span data-el="status">正在读取 Bingo 状态…</span></div>',
    '<div class="bingo-pending" data-el="pending" hidden>',
    '<div class="bingo-pending__head"><span class="bingo-pending__title">检测到新插件</span><span class="bingo-count" data-el="pendingCount"></span></div>',
    '<ul class="bingo-pkgs" data-el="pendingList"></ul>',
    '<div class="bingo-more" data-el="pendingMore" hidden></div>',
    '</div>',
    '<div class="bingo-actions">',
    '<button class="bingo-btn bingo-btn--primary" data-el="primary" type="button"><span class="bingo-btn__spin" aria-hidden="true"></span><span data-el="primaryLabel">Bingo 一下</span></button>',
    '<button class="bingo-btn bingo-btn--ghost" data-el="later" type="button">稍后</button>',
    '<button class="bingo-btn bingo-btn--ghost" data-el="refresh" type="button" hidden>刷新页面</button>',
    '</div>',
    '<p class="bingo-note" data-el="note">会中断正在进行的任务，约 3 秒恢复</p>',
    '<p class="bingo-error" data-el="error" role="alert" hidden></p>',
    '<div class="bingo-meta" data-el="meta" data-failed="false" hidden>' + ICON_CLOCK + '<span data-el="metaText"></span></div>',
    '<footer class="bingo-foot"><span>快捷键</span><span class="bingo-kbd" data-el="kbd">Ctrl + Alt + B</span></footer>',
    '<p class="bingo-sr" data-el="live" role="status" aria-live="polite"></p>',
    '</section>',
    '<div class="bingo-layer bingo-layer--dialog" data-el="dialogLayer" hidden>',
    '<div class="bingo-dialog" data-el="dialog" role="alertdialog" aria-modal="true" aria-labelledby="bingo-dialog-title" aria-describedby="bingo-dialog-desc" tabindex="-1">',
    '<div class="bingo-dialog__icon" aria-hidden="true">' + ICON_SPARK + '</div>',
    '<h2 class="bingo-dialog__title" id="bingo-dialog-title">检测到新插件</h2>',
    '<p class="bingo-dialog__desc" id="bingo-dialog-desc">是否要 Bingo 一下？重启 Harness 后新插件才会生效。</p>',
    '<ul class="bingo-pkgs bingo-pkgs--dialog" data-el="dialogList"></ul>',
    '<div class="bingo-more bingo-more--dialog" data-el="dialogMore" hidden></div>',
    '<div class="bingo-dialog__actions">',
    '<button class="bingo-btn bingo-btn--primary" data-el="dialogPrimary" type="button">立即 Bingo</button>',
    '<button class="bingo-btn bingo-btn--ghost" data-el="dialogLater" type="button">稍后</button>',
    '</div>',
    '<p class="bingo-dialog__hint">稍后可从左下角的 Bingo 面板随时处理</p>',
    '</div>',
    '</div>',
    '<div class="bingo-layer bingo-layer--restart" data-el="restartLayer" hidden>',
    '<div class="bingo-restart" data-el="restartCard" role="status" aria-live="assertive" tabindex="-1">',
    '<span class="bingo-spinner" aria-hidden="true"></span>',
    '<div class="bingo-restart__title">正在重启 Harness</div>',
    '<div class="bingo-restart__hint">页面会自动恢复，请稍候</div>',
    '<div class="bingo-restart__manual" data-el="manualHint" hidden>如果长时间未恢复，请手动启动 DeepSeek Harness。</div>',
    '</div>',
    '</div>'
  ].join('');

  var S = {
    status: null,
    pending: null,
    version: VERSION,
    failures: 0,
    shown: false,
    panel: false,
    dialog: false,
    dialogSig: '',
    restarting: false,
    busy: false,
    emitted: false,
    inFlight: false,
    timer: 0,
    manualTimer: 0,
    pollMs: DEFAULT_POLL,
    seen: Object.create(null),
  };

  var host = null;
  var shadow = null;
  var root = null;
  var link = null;
  var els = {};
  var lastFocus = null;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }


  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function live(text) {
    if (!els.live) return;
    els.live.textContent = text || '';
  }

  function detectTheme() {
    var forced = window.__DSH_BINGO_FORCE_THEME__;
    if (forced === 'dark' || forced === 'light') return forced;
    var html = document.documentElement;
    var body = document.body;
    var explicit = html.getAttribute('data-theme') || html.getAttribute('data-ds-theme-source');
    if (explicit !== 'dark' && explicit !== 'light' && body) {
      explicit = body.getAttribute('data-theme') || body.getAttribute('data-ds-theme-source');
    }
    if (explicit === 'dark' || explicit === 'light') return explicit;
    if (html.classList.contains('dark') || (body && body.classList.contains('dark'))) return 'dark';
    if (html.classList.contains('light')) return 'light';
    if (body && body.hasAttribute('data-ds-dark-theme')) return 'dark';
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (err) {
      return 'light';
    }
  }

  function applyTheme() {
    if (!root) return;
    root.setAttribute('data-theme', detectTheme());
  }

  function applyPosition(position) {
    if (position !== 'bottom-right' && position !== 'bottom-left') return;
    if (host) host.setAttribute('data-position', position);
  }

  function watchTheme() {
    try {
      if (typeof MutationObserver === 'undefined') return;
      var observer = new MutationObserver(applyTheme);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'data-ds-theme-source']
      });
      if (document.body) {
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-ds-dark-theme', 'data-ds-theme-source']
        });
      }
    } catch (err) {}
    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', applyTheme);
      else if (mq.addListener) mq.addListener(applyTheme);
    } catch (err) {}
  }

  function request(path, init) {
    var ctrl = null;
    var timer = 0;
    try {
      if (typeof AbortController !== 'undefined') ctrl = new AbortController();
    } catch (err) {}
    var options = {
      method: (init && init.method) || 'GET',
      cache: 'no-store'
    };
    if (init && init.body != null) {
      options.body = init.body;
      options.headers = { 'Content-Type': 'application/json' };
    }
    if (ctrl) {
      options.signal = ctrl.signal;
      timer = window.setTimeout(function () {
        try { ctrl.abort(); } catch (err) {}
      }, REQUEST_TIMEOUT);
    }
    return fetch(path, options).then(function (res) {
      if (timer) window.clearTimeout(timer);
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          var error = new Error('HTTP ' + res.status);
          error.status = res.status;
          error.data = data;
          throw error;
        }
        return data;
      });
    }, function (error) {
      if (timer) window.clearTimeout(timer);
      throw error;
    });
  }

  function nextRetry() {
    return Math.min(MAX_RETRY, 2000 * Math.pow(2, Math.max(0, S.failures - 1)));
  }

  function schedule(ms) {
    if (S.timer) window.clearTimeout(S.timer);
    S.timer = 0;
    if (document.hidden) return;
    S.timer = window.setTimeout(function () {
      S.timer = 0;
      pollOnce(false);
    }, Math.max(0, ms || 0));
  }

  function pollOnce(force) {
    if (S.inFlight) return;
    if (!force && document.hidden) return;
    S.inFlight = true;
    request(API + '/status').then(function (data) {
      if (!data || data.ok === false) throw new Error('Bad status');
      S.failures = 0;
      S.status = data;
      S.pending = data.pending || null;
      if (typeof data.pollMs === 'number') S.pollMs = clamp(data.pollMs, 1500, 60000);
      applyPosition(data.position);
      applyVersion(data.version);
      render();
      reveal();
      if (data.restarting) enterRestarting(true);
      handlePending();
      if (!S.emitted) {
        S.emitted = true;
        try {
          window.dispatchEvent(new CustomEvent('dsh-bingo:ready', { detail: { status: data } }));
        } catch (err) {}
      }
      schedule(S.restarting ? 1200 : S.pollMs);
    }).catch(function () {
      S.failures += 1;
      if (S.failures >= 3 && !S.restarting) conceal();
      render();
      schedule(nextRetry());
    }).then(function () {
      S.inFlight = false;
    });
  }

  function applyVersion(version) {
    if (!version || typeof version !== 'string' || version === S.version) return;
    S.version = version;
    if (els.version) els.version.textContent = 'v' + version;
  }

  function reveal() {
    if (!root || S.shown) return;
    S.shown = true;
    root.setAttribute('data-visible', 'true');
  }

  function conceal() {
    if (S.panel) closePanel(false);
    if (S.dialog) closeDialog(false);
    S.shown = false;
    if (root) root.setAttribute('data-visible', 'false');
  }

  function handlePending() {
    var pending = S.pending;
    var signature = pending && pending.signature ? String(pending.signature) : '';
    if (!pending) {
      if (S.dialog) closeDialog(false);
      return;
    }
    if (signature && signature !== S.dialogSig && !S.seen[signature] && AUTO_DIALOG && !S.restarting) {
      S.seen[signature] = true;
      openDialog();
      return;
    }
    if (S.dialog && signature !== S.dialogSig) {
      S.dialogSig = signature;
      render();
    }
  }

  function statusText() {
    var status = S.status;
    if (S.restarting || (status && status.restarting)) return '正在重启 Harness…';
    if (!status) return S.failures ? '暂时无法连接服务' : '正在读取 Bingo 状态…';
    if (!status.desktop) return '当前为 Web 运行方式';
    if (status.canRestart === false) return '重启已被禁用';
    return 'Harness 桌面端 · 可重启';
  }

  function noteText() {
    var status = S.status;
    if (!status) return '会中断正在进行的任务，约 3 秒恢复';
    if (!status.desktop) return 'Web 运行方式不支持整应用重启，可刷新页面';
    if (status.canRestart === false) return '重启已被禁用，可在插件配置中开启';
    return '会中断正在进行的任务，约 3 秒恢复';
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      var date = new Date(iso);
      if (isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date);
    } catch (err) {
      return '';
    }
  }

  function formatVersion(version) {
    if (version == null || version === '') return '';
    var text = String(version);
    return text.charAt(0) === 'v' ? text : 'v' + text;
  }

  function fillPackages(list, more, packages, limit) {
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    var items = Array.isArray(packages) ? packages : [];
    items.slice(0, limit).forEach(function (pkg) {
      var name = pkg && pkg.name ? String(pkg.name) : '未知插件';
      var version = formatVersion(pkg && pkg.version);
      var row = el('li', 'bingo-pkg');
      row.appendChild(el('span', 'bingo-pkg__name', name));
      row.appendChild(el('span', 'bingo-pkg__ver', version));
      list.appendChild(row);
    });
    var extra = items.length - limit;
    if (!more) return;
    more.hidden = extra <= 0;
    if (extra > 0) more.textContent = '还有 ' + extra + ' 个插件';
  }

  function render() {
    if (!root) return;
    var status = S.status;
    var pending = S.pending;
    var restarting = !!(S.restarting || (status && status.restarting));
    var canRestart = !!(status && status.canRestart && !restarting && !S.busy);

    els.version.textContent = 'v' + (S.version || VERSION);
    els.status.textContent = statusText();
    els.statusDot.hidden = !status;
    els.statusDot.setAttribute('data-tone', restarting ? 'warn' : (!status || !status.desktop || status.canRestart === false ? 'warn' : 'ok'));

    els.pill.dataset.pending = pending ? 'true' : 'false';
    els.pill.dataset.loading = restarting ? 'true' : 'false';
    els.pill.disabled = restarting;
    els.pill.setAttribute('aria-busy', restarting ? 'true' : 'false');

    els.pending.hidden = !pending;
    if (pending) {
      var packages = Array.isArray(pending.packages) ? pending.packages : [];
      fillPackages(els.pendingList, els.pendingMore, packages, PANEL_PENDING_LIMIT);
      els.pendingCount.textContent = packages.length + ' 个';
    }

    els.primary.disabled = !canRestart;
    els.primary.dataset.loading = restarting || S.busy ? 'true' : 'false';
    els.primaryLabel.textContent = restarting ? '正在 Bingo…' : (S.busy ? '正在请求…' : 'Bingo 一下');
    els.later.textContent = '稍后';
    els.refresh.hidden = !(status && status.desktop === false);
    els.note.textContent = noteText();

    els.meta.hidden = !(status && status.lastRestart);
    if (status && status.lastRestart) {
      var last = status.lastRestart;
      var ok = last.ok !== false;
      els.meta.setAttribute('data-failed', ok ? 'false' : 'true');
      els.metaText.textContent = '上次重启 · ' + (formatTime(last.at) || '时间未知') + ' · ' + (ok ? '成功' : '未确认');
    }

    if (S.dialog && pending) {
      fillPackages(els.dialogList, els.dialogMore, pending.packages, DIALOG_PENDING_LIMIT);
      els.dialogPrimary.disabled = restarting || S.busy;
    }
  }

  function showError(message) {
    if (!els.error) return;
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    if (!els.error) return;
    els.error.hidden = true;
    els.error.textContent = '';
  }

  function focusPill() {
    try { els.pill.focus({ preventScroll: true }); } catch (err) {
      try { els.pill.focus(); } catch (err2) {}
    }
  }

  function activeElement() {
    try { return shadow && shadow.activeElement; } catch (err) { return null; }
  }

  function rememberFocus() {
    var node = activeElement();
    if (node && els.panel.contains(node)) node = null;
    if (!node) {
      node = document.activeElement;
      if (node === document.body || (host && host.contains(node))) node = null;
    }
    lastFocus = node || null;
  }

  function restoreFocus() {
    var node = lastFocus;
    lastFocus = null;
    if (node && node.isConnected) {
      try { node.focus({ preventScroll: true }); return; } catch (err) {}
    }
    focusPill();
  }

  function openPanel() {
    if (S.panel || S.restarting) return;
    S.panel = true;
    els.panel.hidden = false;
    els.pill.setAttribute('aria-expanded', 'true');
    render();
    window.setTimeout(function () {
      if (!S.panel) return;
      try { els.close.focus({ preventScroll: true }); } catch (err) {}
    }, 40);
  }

  function closePanel(returnFocus) {
    if (!S.panel) return;
    S.panel = false;
    els.panel.hidden = true;
    els.pill.setAttribute('aria-expanded', 'false');
    if (returnFocus !== false) focusPill();
  }

  function togglePanel() {
    if (S.dialog) return;
    if (S.panel) closePanel();
    else openPanel();
  }

  function openDialog() {
    if (!S.pending || S.restarting) return;
    rememberFocus();
    S.dialog = true;
    S.dialogSig = S.pending.signature ? String(S.pending.signature) : '';
    closePanel(false);
    render();
    els.dialogLayer.hidden = false;
    root.setAttribute('data-dialog', 'true');
    live('检测到新插件，是否要 Bingo 一下？');
    window.setTimeout(function () {
      if (!S.dialog) return;
      try { els.dialogPrimary.focus({ preventScroll: true }); } catch (err) {}
    }, 40);
  }

  function closeDialog(returnFocus) {
    if (!S.dialog) return;
    S.dialog = false;
    S.dialogSig = '';
    els.dialogLayer.hidden = true;
    root.removeAttribute('data-dialog');
    if (returnFocus !== false && !S.restarting) restoreFocus();
  }

  function dismissPending(source) {
    var pending = S.pending;
    var signature = pending && pending.signature ? String(pending.signature) : '';
    if (!signature) {
      if (S.dialog) closeDialog();
      else closePanel();
      return;
    }
    S.seen[signature] = true;
    S.pending = null;
    if (S.status) S.status.pending = null;
    render();
    closeDialog();
    live('已稍后处理');
    request(API + '/dismiss', {
      method: 'POST',
      body: JSON.stringify({ signature: signature })
    }).catch(function () {});
  }

  function handleRestartError(error) {
    var code = error && error.data && error.data.code;
    if (code === 'restarting') {
      enterRestarting(true);
      return;
    }
    var message;
    if (code === 'unsupported') message = '当前运行方式不支持整应用重启。';
    else if (code === 'spawn-failed') message = '重启进程启动失败，请查看 bingo/restart.log。';
    else if (error && error.status === 403) message = '请求被宿主拒绝，请刷新页面后重试。';
    else message = '重启请求失败，请稍后再试。';
    showError(message);
    live(message);
  }

  function triggerRestart(trigger) {
    if (!S.status || !S.status.canRestart || S.restarting || S.busy) return;
    clearError();
    S.busy = true;
    render();
    request(API + '/restart', {
      method: 'POST',
      body: JSON.stringify({ trigger: trigger })
    }).then(function (data) {
      if (!data || data.ok === false) {
        var error = new Error('Restart rejected');
        error.data = data;
        throw error;
      }
      S.busy = false;
      enterRestarting(false);
    }).catch(function (error) {
      S.busy = false;
      render();
      handleRestartError(error);
    });
  }

  function enterRestarting() {
    if (S.restarting) return;
    S.restarting = true;
    S.busy = false;
    closePanel(false);
    closeDialog(false);
    els.restartLayer.hidden = false;
    render();
    live('正在重启 Harness，页面会自动恢复');
    try { els.restartCard.focus({ preventScroll: true }); } catch (err) {}
    if (S.manualTimer) window.clearTimeout(S.manualTimer);
    S.manualTimer = window.setTimeout(function () {
      if (!S.restarting) return;
      els.manualHint.hidden = false;
    }, MANUAL_HINT_AFTER);
    schedule(1200);
  }

  function trapTab(event) {
    var nodes = els.dialog.querySelectorAll('button:not([disabled])');
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    var active = activeElement();
    if (event.shiftKey && (active === first || !els.dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !els.dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKeyDown(event) {
    var key = event.key || '';
    if ((event.ctrlKey || event.metaKey) && event.altKey && (key === 'b' || key === 'B' || event.code === 'KeyB')) {
      if (S.restarting) return;
      event.preventDefault();
      togglePanel();
      return;
    }
    if (key === 'Escape' || key === 'Esc') {
      if (S.dialog) {
        event.preventDefault();
        event.stopPropagation();
        dismissPending('esc');
        return;
      }
      if (S.panel) {
        event.preventDefault();
        closePanel();
        return;
      }
    }
    if (key === 'Tab' && S.dialog) trapTab(event);
  }

  function onPointerDown(event) {
    if (!S.panel) return;
    var path = event.composedPath ? event.composedPath() : [];
    var inside = false;
    for (var i = 0; i < path.length; i += 1) {
      if (path[i] === els.panel || path[i] === els.pill) { inside = true; break; }
    }
    if (!inside) closePanel();
  }

  function onVisibility() {
    if (document.hidden) {
      if (S.timer) window.clearTimeout(S.timer);
      S.timer = 0;
      return;
    }
    pollOnce(true);
  }

  function bind() {
    els.pill.addEventListener('click', togglePanel);
    els.close.addEventListener('click', function () { closePanel(); });
    els.primary.addEventListener('click', function () {
      if (!S.status || !S.status.canRestart) return;
      triggerRestart('button');
    });
    els.later.addEventListener('click', function () {
      if (S.pending) dismissPending('panel');
      else closePanel();
    });
    els.refresh.addEventListener('click', function () {
      try { window.location.reload(); } catch (err) {}
    });
    els.dialogPrimary.addEventListener('click', function () {
      if (!S.status || !S.status.canRestart) return;
      triggerRestart('new-plugin');
    });
    els.dialogLater.addEventListener('click', function () { dismissPending('dialog'); });
    els.dialogLayer.addEventListener('pointerdown', function (event) {
      if (event.target === els.dialogLayer) dismissPending('overlay');
    });
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function expose() {
    window.__DSH_BINGO__ = { openPanel: openPanel };
  }

  function mount() {
    if (document.getElementById('dsh-bingo-host')) return;
    host = document.createElement('div');
    host.id = 'dsh-bingo-host';
    host.setAttribute('data-dsh-bingo', '');
    host.setAttribute('data-position', INITIAL_POSITION);
    host.hidden = true;

    shadow = host.attachShadow({ mode: 'open' });
    root = document.createElement('div');
    root.className = 'bingo-root';
    root.setAttribute('data-visible', 'false');
    root.setAttribute('data-theme', detectTheme());
    root.innerHTML = TEMPLATE;
    shadow.appendChild(root);

    var names = root.querySelectorAll('[data-el]');
    for (var i = 0; i < names.length; i += 1) {
      els[names[i].getAttribute('data-el')] = names[i];
    }
    els.kbd.textContent = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘ + Alt + B' : 'Ctrl + Alt + B';

    bind();
    expose();
    applyTheme();
    watchTheme();

    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_URL;
    link.addEventListener('load', function () {
      host.hidden = false;
      pollOnce(true);
    });
    link.addEventListener('error', function () {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    });
    shadow.appendChild(link);

    document.body.appendChild(host);
  }

  function boot() {
    if (!document.body) {
      window.setTimeout(boot, 40);
      return;
    }
    try {
      mount();
    } catch (err) {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    }
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
