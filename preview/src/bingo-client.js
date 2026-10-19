(function () {
  'use strict';

  if (window.__DSH_BINGO_LOADED__) return;
  window.__DSH_BINGO_LOADED__ = true;

  var VERSION = typeof window.__DSH_BINGO_VERSION__ === 'string' && window.__DSH_BINGO_VERSION__
    ? window.__DSH_BINGO_VERSION__
    : '0.4.0';
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
  var POS_KEY = 'dsh-bingo.position.v1';
  var SNAP_MARGIN = 16;
  var SNAP_THRESHOLD = 64;
  var DRAG_SLOP = 4;

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
    '<button class="bingo-btn bingo-btn--ghost bingo-manage" data-el="manage" type="button">插件记录 · 试用 · 验收</button>',
    '<footer class="bingo-foot"><span>快捷键</span><span class="bingo-kbd" data-el="kbd">Ctrl + Alt + B</span></footer>',
    '<p class="bingo-sr" data-el="live" role="status" aria-live="polite"></p>',
    '</section>',
    '<div class="bingo-layer bingo-layer--dialog" data-el="dialogLayer" hidden>',
    '<div class="bingo-dialog" data-el="dialog" role="alertdialog" aria-modal="true" aria-labelledby="bingo-dialog-title" aria-describedby="bingo-dialog-desc" tabindex="-1">',
    '<div class="bingo-dialog__icon" aria-hidden="true">' + ICON_SPARK + '</div>',
    '<h2 class="bingo-dialog__title" id="bingo-dialog-title">检测到新插件</h2>',
    '<p class="bingo-dialog__desc" id="bingo-dialog-desc">是否要 Bingo 一下？部分插件需要重启后生效。</p>',
    '<ul class="bingo-pkgs bingo-pkgs--dialog" data-el="dialogList"></ul>',
    '<div class="bingo-more bingo-more--dialog" data-el="dialogMore" hidden></div>',
    '<div class="bingo-dialog__actions">',
    '<button class="bingo-btn bingo-btn--primary" data-el="dialogPrimary" type="button">立即 Bingo</button>',
    '<button class="bingo-btn bingo-btn--ghost" data-el="dialogLater" type="button">稍后</button>',
    '</div>',
    '<button class="bingo-btn bingo-btn--ghost bingo-manage" data-el="tryGroup" type="button">本次新增设为试用</button>',
    '<p class="bingo-dialog__hint">稍后可从左下角的 Bingo 面板随时处理</p>',
    '</div>',
    '</div>',
    '<div class="bingo-layer bingo-layer--dialog" data-el="deskLayer" hidden>',
    '<section class="bingo-desk" data-el="desk" role="dialog" aria-modal="true" aria-labelledby="bingo-desk-title" tabindex="-1">',
    '<header class="bingo-head"><strong id="bingo-desk-title">Bingo 插件管家</strong><button class="bingo-iconbtn" data-el="deskClose" type="button" aria-label="关闭插件管家">' + ICON_CLOSE + '</button></header>',
    '<nav class="bingo-tabs" aria-label="插件管理"><button data-el="historyTab" type="button">变更记录</button><button data-el="trialsTab" type="button">临时试用</button><button data-el="recoveryTab" type="button">恢复</button><button data-el="checksTab" type="button">验收清单</button></nav>',
    '<div class="bingo-desk-toolbar"><span data-el="deskMessage" role="status" aria-live="polite"></span><button class="bingo-btn bingo-btn--ghost" data-el="deskRefresh" type="button">刷新</button></div>',
    '<div class="bingo-desk-content" data-el="deskContent"></div>',
    '</section></div>',
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
    restartCycle: 0,
    busy: false,
    emitted: false,
    inFlight: false,
    timer: 0,
    manualTimer: 0,
    pollMs: DEFAULT_POLL,
    seen: Object.create(null),
    pos: null,
    edge: null,
    posUser: false,
    drag: null,
    suppressClick: false,
    desk: false,
    deskTab: 'history',
    activity: null,
    activityBusy: false,
    activityLoading: false,
    removeConfirm: '',
    reviewSeen: Object.create(null),
    recovery: null,
    timeline: null,
    recoveryLoading: false,
    rollbackConfirm: '',
    safeConfirm: false,
    cleanupPick: Object.create(null),
    cleanupConfirm: false,
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

  function viewportSize() {
    return {
      w: Math.max(0, window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0),
      h: Math.max(0, window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0)
    };
  }

  function pillSize() {
    var rect = els.pill ? els.pill.getBoundingClientRect() : null;
    return { w: (rect && rect.width) || 120, h: (rect && rect.height) || 44 };
  }

  function edgeMargin() {
    return viewportSize().w <= 480 ? 12 : SNAP_MARGIN;
  }

  function readSavedPosition() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(POS_KEY);
      if (!raw) return null;
      var value = JSON.parse(raw);
      if (!value || typeof value.x !== 'number' || typeof value.y !== 'number') return null;
      var edge = value.edge && typeof value.edge === 'object'
        ? { h: value.edge.h === 'left' || value.edge.h === 'right' ? value.edge.h : null, v: value.edge.v === 'top' || value.edge.v === 'bottom' ? value.edge.v : null }
        : null;
      return { x: value.x, y: value.y, edge: edge };
    } catch (err) {}
    return null;
  }

  function savePosition(pos) {
    try {
      if (window.localStorage) window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch (err) {}
  }

  function currentEdge(x, y, size, vp, margin) {
    var edge = 'free';
    if (x <= margin + SNAP_THRESHOLD) edge = 'left';
    else if (vp.w - (x + size.w) <= margin + SNAP_THRESHOLD) edge = 'right';
    if (y <= margin + SNAP_THRESHOLD) edge = edge === 'free' ? 'top' : edge + '-top';
    else if (vp.h - (y + size.h) <= margin + SNAP_THRESHOLD) edge = edge === 'free' ? 'bottom' : edge + '-bottom';
    return edge;
  }

  function setPosition(x, y, persist, edge) {
    if (edge !== undefined) S.edge = edge;
    var vp = viewportSize();
    var size = pillSize();
    var margin = edgeMargin();
    var maxX = Math.max(margin, vp.w - size.w - margin);
    var maxY = Math.max(margin, vp.h - size.h - margin);
    var nx = Math.min(maxX, Math.max(margin, x));
    var ny = Math.min(maxY, Math.max(margin, y));
    S.pos = { x: nx, y: ny };
    if (!host) return;
    host.style.left = nx + 'px';
    host.style.top = ny + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.setAttribute('data-edge', currentEdge(nx, ny, size, vp, margin));
    if (persist) savePosition({ x: nx, y: ny, edge: S.edge || null });
    if (S.panel) positionPanel();
  }

  function applySaved(saved) {
    var vp = viewportSize();
    var size = pillSize();
    var margin = edgeMargin();
    var x = saved.x;
    var y = saved.y;
    var edge = saved.edge || null;
    if (edge && edge.h === 'left') x = margin;
    else if (edge && edge.h === 'right') x = vp.w - size.w - margin;
    if (edge && edge.v === 'top') y = margin;
    else if (edge && edge.v === 'bottom') y = vp.h - size.h - margin;
    setPosition(x, y, false, edge);
  }

  function reapplySaved() {
    if (S.drag) return;
    var saved = readSavedPosition();
    if (saved) applySaved(saved);
  }

  function scheduleReapply() {
    try {
      if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready.then(reapplySaved).catch(function () {});
      }
    } catch (err) {}
    window.setTimeout(reapplySaved, 300);
  }

  function initPosition() {
    var saved = readSavedPosition();
    if (saved) {
      S.posUser = true;
      applySaved(saved);
      scheduleReapply();
      return;
    }
    var vp = viewportSize();
    var size = pillSize();
    var x = INITIAL_POSITION === 'bottom-right' ? vp.w - 18 - size.w : 18;
    setPosition(x, vp.h - 64 - size.h, false);
  }

  function snapToEdges() {
    if (!S.pos) return;
    var vp = viewportSize();
    var size = pillSize();
    var margin = edgeMargin();
    var x = S.pos.x;
    var y = S.pos.y;
    var dLeft = x - margin;
    var dRight = vp.w - (x + size.w) - margin;
    var dTop = y - margin;
    var dBottom = vp.h - (y + size.h) - margin;
    var nx = x;
    var ny = y;
    var hEdge = null;
    var vEdge = null;
    if (dLeft <= SNAP_THRESHOLD && dLeft <= dRight) { nx = margin; hEdge = 'left'; }
    else if (dRight <= SNAP_THRESHOLD) { nx = vp.w - size.w - margin; hEdge = 'right'; }
    if (dTop <= SNAP_THRESHOLD && dTop <= dBottom) { ny = margin; vEdge = 'top'; }
    else if (dBottom <= SNAP_THRESHOLD) { ny = vp.h - size.h - margin; vEdge = 'bottom'; }
    S.edge = { h: hEdge, v: vEdge };
    if (host) host.classList.add('is-snapping');
    setPosition(nx, ny, true, S.edge);
    window.setTimeout(function () {
      if (host) host.classList.remove('is-snapping');
    }, 220);
  }

  function positionPanel() {
    if (!S.panel || !els.panel || els.panel.hidden) return;
    var button = els.pill.getBoundingClientRect();
    var panel = els.panel.getBoundingClientRect();
    var vp = viewportSize();
    var gap = 10;
    var pad = 8;
    var width = panel.width || 312;
    var height = panel.height || 200;
    var top = button.top - height - gap;
    if (top < pad) top = button.bottom + gap;
    var left = button.left;
    if (left + width > vp.w - pad) left = button.right - width;
    left = Math.max(pad, Math.min(left, Math.max(pad, vp.w - width - pad)));
    top = Math.max(pad, Math.min(top, Math.max(pad, vp.h - height - pad)));
    els.panel.style.position = 'fixed';
    els.panel.style.left = left + 'px';
    els.panel.style.top = top + 'px';
    els.panel.style.right = 'auto';
    els.panel.style.bottom = 'auto';
    els.panel.style.maxHeight = Math.max(160, vp.h - pad * 2) + 'px';
    els.panel.style.overflow = 'auto';
    els.panel.style.transformOrigin = (top < button.top ? 'bottom' : 'top') + ' ' + (left < button.left ? 'right' : 'left');
  }

  function onResize() {
    if (!S.pos) return;
    var vp = viewportSize();
    var size = pillSize();
    var margin = edgeMargin();
    var x = S.pos.x;
    var y = S.pos.y;
    if (S.edge && S.edge.h === 'left') x = margin;
    else if (S.edge && S.edge.h === 'right') x = vp.w - size.w - margin;
    else if (x <= margin + 2) x = margin;
    else if (x + size.w >= vp.w - margin - 2) x = vp.w - size.w - margin;
    if (S.edge && S.edge.v === 'top') y = margin;
    else if (S.edge && S.edge.v === 'bottom') y = vp.h - size.h - margin;
    else if (y <= margin + 2) y = margin;
    else if (y + size.h >= vp.h - margin - 2) y = vp.h - size.h - margin;
    setPosition(x, y, true, S.edge);
    if (S.panel) positionPanel();
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
      }, (init && init.timeout) || REQUEST_TIMEOUT);
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
    var restartCycle = S.restartCycle;
    request(API + '/status').then(function (data) {
      if (!data || data.ok === false) throw new Error('Bad status');
      S.failures = 0;
      S.status = data;
      S.pending = data.pending || null;
      if (typeof data.pollMs === 'number') S.pollMs = clamp(data.pollMs, 1500, 60000);
      applyVersion(data.version);
      render();
      reveal();
      if (data.restarting) enterRestarting(true);
      else if (S.restarting && restartCycle === S.restartCycle) leaveRestarting();
      handlePending();
      var review = data.activity;
      if (review && review.reviewCount > 0 && review.reviewSignature && !S.reviewSeen[review.reviewSignature] && !S.restarting && !S.dialog && !S.panel && !S.desk) {
        S.reviewSeen[review.reviewSignature] = true;
        openDesk('trials');
      }
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
    // The root is display:none until this point, so every earlier measurement
    // used the 120px fallback. Re-apply now that the pill has a real width.
    initPosition();
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
    if (signature && signature !== S.dialogSig && !S.seen[signature] && AUTO_DIALOG && !S.restarting && !S.desk) {
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
    if (els.manage) {
      var reviews = status && status.activity && status.activity.reviewCount || 0;
      els.manage.textContent = reviews ? '插件管家 · ' + reviews + ' 个试用待决定' : '插件记录 · 试用 · 验收';
    }
    if (els.tryGroup) els.tryGroup.disabled = S.busy || restarting;

    els.meta.hidden = !(status && status.lastRestart);
    if (status && status.lastRestart) {
      var last = status.lastRestart;
      var ok = last.ok !== false;
      els.meta.setAttribute('data-failed', ok ? 'false' : 'true');
      els.metaText.textContent = '上次重启 · ' + (formatTime(last.at) || '时间未知') + ' · ' + (ok ? '成功' : '未确认');
    }

    if (S.dialog && pending) {
      fillPackages(els.dialogList, els.dialogMore, pending.packages, DIALOG_PENDING_LIMIT);
      els.dialogPrimary.disabled = !canRestart;
    }
    if (S.panel) positionPanel();
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
    positionPanel();
    window.setTimeout(function () {
      if (!S.panel) return;
      positionPanel();
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
    if (S.dialog) { closeDialog(false); openPanel(); }
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
    S.restartCycle += 1;
    S.busy = false;
    closePanel(false);
    closeDialog(false);
    if (S.desk) closeDesk(false);
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

  function leaveRestarting() {
    S.restarting = false;
    if (S.manualTimer) window.clearTimeout(S.manualTimer);
    S.manualTimer = 0;
    els.restartLayer.hidden = true;
    render();
    openPanel();
    if (S.status && S.status.lastRestart && S.status.lastRestart.ok === false) {
      showError('重启未完成，请查看日志后重试。');
      live('重启失败，可以重试');
    }
  }

  function activityError(error) {
    var code = error && error.data && error.data.code;
    var messages = {
      'version-changed': '插件版本已变化，请刷新后重新标记试用。',
      'trial-changed': '试用记录已变化，请刷新后重试。',
      'not-trialable': '该插件无法标记试用，Bingo 本身不支持试用移除。',
      'not-removable': '宿主不允许移除此插件，请到 Harness 插件页查看。',
      'manager-unavailable': '宿主移除接口暂不可用，请到 Harness 插件页操作。',
      'native-remove-refused': '宿主未完成移除，请到 Harness 插件页查看原因；可能需要先退出应用。',
      'removal-incomplete': '插件清单仍包含该插件，请到 Harness 插件页确认移除结果。',
      'operation-busy': '有操作正在进行，请稍候。',
      'state-unwritable': '记录无法保存，请检查本机状态目录权限。',
      'trial-limit': '试用列表已满，请先保留或移除部分试用插件。',
      'confirmation-required': '请再确认一次。',
      'checkpoint-missing': '这个回滚点已失效，请刷新后重试。',
      'invalid-checkpoint': '回滚点无效，请刷新后重试。',
      'nothing-to-disable': '当前没有可停用的社区插件。',
      'not-in-safe-mode': '当前不在安全模式。',
      'plugin-operation': '插件管理器正在安装或更新，等它完成后重试。',
      'pnpm-lock': 'pnpm 正在占用目录，等它完成后重试。',
      'restarting': '正在重启，请稍候。',
    };
    return messages[code] || '操作未完成，请刷新查看当前状态后重试。';
  }

  function deskButton(label, handler, disabled) {
    var button = el('button', 'bingo-btn bingo-btn--ghost', label);
    button.type = 'button';
    button.disabled = !!(disabled || S.activityBusy);
    button.addEventListener('click', handler);
    return button;
  }

  function renderDesk() {
    if (!S.desk || !els.deskContent) return;
    var content = els.deskContent;
    while (content.firstChild) content.removeChild(content.firstChild);
    ['history', 'trials', 'checks'].forEach(function (tab) {
      els[tab + 'Tab'].setAttribute('aria-pressed', S.deskTab === tab ? 'true' : 'false');
    });
    els.deskClose.disabled = S.activityBusy;
    els.deskRefresh.disabled = S.activityBusy || S.activityLoading;
    var data = S.activity;
    if (!data) { content.appendChild(el('p', 'bingo-muted', '正在读取插件信息…')); return; }
    var note = function (text) { content.appendChild(el('p', 'bingo-muted', text)); };
    var card = function (title, detail) {
      var row = el('article', 'bingo-record');
      row.appendChild(el('strong', '', title));
      if (detail) row.appendChild(el('p', 'bingo-muted', detail));
      content.appendChild(row);
      return row;
    };
    if (S.deskTab === 'history') {
      note('记录启用 Bingo 后观察到的变化，最近显示 100 条。版本以插件清单声明为准；不记录聊天内容。');
      var kinds = { added: '新增', updated: '版本变更', removed: '移除', 'trial-started': '开始试用', 'trial-kept': '保留试用插件', 'trial-removed': '移除试用插件' };
      if (!data.history.length) note('还没有变更记录。下次安装、更新或移除插件后会出现在这里。');
      data.history.forEach(function (item) {
        var detail = formatTime(item.at) + (item.source === 'startup' ? ' · 启动时发现' : '');
        if (item.kind === 'updated') detail += ' · ' + (item.from || '未声明') + ' → ' + (item.to || '未声明');
        else if (item.to || item.from) detail += ' · ' + (item.to || item.from);
        card((kinds[item.kind] || '变更') + ' · ' + item.name, detail);
      });
    } else if (S.deskTab === 'trials') {
      note('安装后标记试用，下次启动提醒你决定。试用不隔离插件权限，也不会自动卸载；“保留”只结束提醒。');
      var controls = el('div', 'bingo-trial-controls');
      var select = el('select', 'bingo-select');
      select.setAttribute('aria-label', '选择要试用的已安装插件');
      data.packages.forEach(function (pkg) {
        var option = el('option', '', pkg.name);
        option.value = pkg.name;
        select.appendChild(option);
      });
      select.disabled = S.activityBusy;
      controls.appendChild(select);
      controls.appendChild(deskButton('标记试用', function () {
        var pkg = data.packages.filter(function (p) { return p.name === select.value; })[0];
        if (pkg) performTrial('start', pkg);
      }, !data.packages.length));
      content.appendChild(controls);
      if (!data.trials.length) note('暂无试用插件。也可以在新插件提醒中选择“本次新增设为试用”。');
      data.trials.forEach(function (trial) {
        var row = card(trial.name, (trial.reviewDue ? '待决定' : '试用中') + ' · ' + (trial.version || '未声明版本') + ' · ' + formatTime(trial.createdAt));
        var actions = el('div', 'bingo-record-actions');
        actions.appendChild(deskButton('保留', function () { performTrial('keep', trial); }));
        actions.appendChild(deskButton('下次启动再问', function () { performTrial('snooze', trial); }, !trial.reviewDue));
        if (trial.versionChanged) {
          row.appendChild(el('p', 'bingo-muted', '安装声明已变化。重新标记后才能移除，避免误删替换后的版本。'));
          actions.appendChild(deskButton('重新标记', function () {
            var pkg = data.packages.filter(function (p) { return p.name === trial.name; })[0];
            if (pkg) performTrial('start', pkg);
          }));
        }
        actions.appendChild(deskButton(S.removeConfirm === trial.id ? '确认移除' : '移除', function () {
          if (S.removeConfirm !== trial.id) {
            S.removeConfirm = trial.id;
            els.deskMessage.textContent = '确认移除 ' + trial.name + '？由宿主管理器执行，相关功能将停止，其他会话也会受影响。';
            renderDesk();
          } else performTrial('remove', trial);
        }, !trial.removable || !data.canRemove));
        if (S.removeConfirm === trial.id) actions.appendChild(deskButton('取消', function () { S.removeConfirm = ''; renderDesk(); }));
        row.appendChild(actions);
        if (!trial.removable && !trial.versionChanged) row.appendChild(el('p', 'bingo-muted', '当前不能在 Bingo 中移除，请在 Harness 插件页查看。'));
      });
    } else if (S.deskTab === 'recovery') {
      note('回滚只退回插件清单，插件数据保留；安全模式暂时停用社区插件。任何操作都要重启后才生效。');
      var rec = S.recovery;
      if (!rec) { content.appendChild(el('p', 'bingo-muted', '正在读取恢复信息…')); return; }
      if (rec.warning) note(rec.warning);
      if (rec.safeMode) {
        var applied = rec.safeMode.applied !== false;
        var safeRow = card(applied ? '安全模式已启用' : '安全模式未完成',
          (rec.safeMode.disabled || []).length + ' 个社区插件被停用 · ' + formatTime(rec.safeMode.at)
            + (applied ? '' : ' · 有插件没能停用，可以重试'));
        var safeActions = el('div', 'bingo-record-actions');
        safeActions.appendChild(deskButton('退出安全模式', function () {
          if (!S.safeConfirm) {
            S.safeConfirm = true;
            els.deskMessage.textContent = '退出安全模式会重新启用这些插件，需要重启后生效。';
            renderDesk();
            return;
          }
          performSafeMode('exit');
        }));
        if (S.safeConfirm) safeActions.appendChild(deskButton('取消', function () { S.safeConfirm = false; renderDesk(); }));
        safeRow.appendChild(safeActions);
      } else {
        var enterRow = card('插件装坏了的应急处理', '停用所有社区插件后重启，只保留官方基础包。之后可以逐个重新启用。');
        var enterActions = el('div', 'bingo-record-actions');
        enterActions.appendChild(deskButton(S.safeConfirm ? '确认进入安全模式' : '进入安全模式', function () {
          if (!S.safeConfirm) {
            S.safeConfirm = true;
            els.deskMessage.textContent = '进入会停用 ' + ((rec.packages || []).length) + ' 个插件里的社区部分，只保留官方基础包，需要重启后生效。';
            renderDesk();
            return;
          }
          performSafeMode('enter');
        }, rec.busy && rec.busy.busy));
        if (S.safeConfirm) enterActions.appendChild(deskButton('取消', function () { S.safeConfirm = false; renderDesk(); }));
        enterRow.appendChild(enterActions);
      }
      note('最近重启（耗时来自 helper 日志）：');
      var tl = S.timeline;
      if (!tl) note('正在读取重启记录…');
      else if (!tl.items || !tl.items.length) note('还没有重启记录。点「Bingo 一下」之后这里会出现耗时。');
      else {
        if (tl.stats && tl.stats.count) note('已记录 ' + tl.stats.count + ' 次重启，平均 ' + msText(tl.stats.avgMs) + '，最长 ' + msText(tl.stats.maxMs) + '。');
        tl.items.forEach(function (item) {
          var row = card((item.ok === false ? '重启失败' : '重启完成') + ' · ' + formatTime(item.requestedAt),
            msText(item.totalMs) + ' 总计 · 停止 ' + msText(item.phases.stopMs) + ' · 拉起 ' + msText(item.phases.launchMs) + ' · 触发：' + triggerText(item.trigger));
          if (item.plugins && item.plugins.length) {
            var list = el('ul', 'bingo-pkgs bingo-pkgs--inline');
            item.plugins.forEach(function (p) {
              list.appendChild(el('li', '', kindText(p.kind) + ' ' + p.name + (p.to ? ' ' + p.to : '')));
            });
            row.appendChild(list);
          } else {
            row.appendChild(el('p', 'bingo-muted', '本次重启前后没有记录到插件变化。'));
          }
        });
      }
      note('最近可回滚的时间点：');
      if (!rec.checkpoints || !rec.checkpoints.length) note('还没有可回滚的记录。安装或更新插件后会自动留下一个时间点。');
      (rec.checkpoints || []).forEach(function (cp) {
        var row = card('回滚到 ' + formatTime(cp.at), cp.count + ' 个插件 · 触发于' + reasonText(cp.reason));
        var actions = el('div', 'bingo-record-actions');
        actions.appendChild(deskButton(S.rollbackConfirm === cp.id ? '确认回滚' : '回滚到这里', function () {
          if (S.rollbackConfirm !== cp.id) {
            S.rollbackConfirm = cp.id;
            els.deskMessage.textContent = '回滚会按这份清单增删插件，插件数据保留；完成后需要重启。';
            renderDesk();
            return;
          }
          performRollback(cp.id);
        }, rec.busy && rec.busy.busy));
        if (S.rollbackConfirm === cp.id) actions.appendChild(deskButton('取消', function () { S.rollbackConfirm = ''; renderDesk(); }));
        row.appendChild(actions);
      });
      note('残留文件（可安全删除）：');
      if (!rec.leftovers || !rec.leftovers.length) note('没有发现残留文件。');
      (rec.leftovers || []).forEach(function (item) {
        var size = item.bytes ? Math.max(1, Math.round(item.bytes / 1024)) + ' KB' : '大小未知';
        var row = card(leftoverLabel(item.kind) + ' · ' + item.name, size + ' · ' + item.path);
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !!S.cleanupPick[item.path];
        box.setAttribute('aria-label', '选择删除 ' + item.name);
        box.addEventListener('change', function () {
          S.cleanupPick[item.path] = box.checked;
        });
        row.insertBefore(box, row.firstChild);
        content.appendChild(row);
      });
      if (rec.leftovers && rec.leftovers.length) {
        var actions2 = el('div', 'bingo-record-actions');
        actions2.appendChild(deskButton(S.cleanupConfirm ? '确认删除所选' : '删除所选', function () {
          var paths = Object.keys(S.cleanupPick).filter(function (p) { return S.cleanupPick[p]; });
          if (!paths.length) { els.deskMessage.textContent = '请先勾选要删除的残留。'; return; }
          if (!S.cleanupConfirm) {
            S.cleanupConfirm = true;
            els.deskMessage.textContent = '将删除 ' + paths.length + ' 个目录，此操作不可撤销。';
            renderDesk();
            return;
          }
          performCleanup(paths);
        }, rec.busy && rec.busy.busy));
        if (S.cleanupConfirm) actions2.appendChild(deskButton('取消', function () { S.cleanupConfirm = false; renderDesk(); }));
        content.appendChild(actions2);
      }
    } else {
      note('宿主连接正常。检查最近变更的插件，最多 30 个；无变更时显示当前插件。');
      note('“运行中”表示宿主条目已启动，不代表插件业务功能或运行代码版本已独立测试。仅有安装文件时不会判定通过。');
      var states = { active: '运行中', failed: '加载失败', disabled: '已禁用', pending: '等待启动', unknown: '无法确认' };
      if (!data.acceptance.length) note('当前没有可验收的插件。');
      data.acceptance.forEach(function (item) {
        var row = card(item.name, '安装版本：' + (item.installedVersion || '未知') + ' · 声明：' + (item.version || '未声明'));
        var badge = el('span', 'bingo-check-state', states[item.state] || '无法确认');
        badge.setAttribute('data-state', item.state);
        row.appendChild(badge);
      });
    }
  }


  function reasonText(reason) {
    var map = { change: '插件变化', manual: '手动记录', 'safe-mode': '安全模式', 'before-rollback': '回滚前' };
    return map[reason] || reason || '插件变化';
  }

  function leftoverLabel(kind) {
    var map = { ignored: '被移到 .ignored 的旧副本', tmp: '安装中断的临时目录', orphan: '清单里没有的包目录', data: '已卸载插件的数据目录' };
    return map[kind] || '残留';
  }

  function msText(value) {
    if (typeof value !== 'number' || value < 0) return '未知';
    if (value < 1000) return value + ' ms';
    return (value / 1000).toFixed(1) + ' s';
  }

  function triggerText(trigger) {
    var map = { button: '手动点击', 'new-plugin': '新插件提醒', shortcut: '快捷键' };
    return map[trigger] || trigger || '未知';
  }

  function kindText(kind) {
    var map = { added: '新增', updated: '升级', removed: '移除' };
    return map[kind] || '变更';
  }
  function loadRecovery() {
    if (S.recoveryLoading) return Promise.resolve();
    S.recoveryLoading = true;
    loadTimeline();
    return request(API + '/recovery', { timeout: 20000 }).then(function (data) {
      if (!data || data.ok === false) throw new Error('Bad recovery');
      S.recovery = data;
      els.deskMessage.textContent = data.warning || '记录仅保存在本机';
    }).catch(function (error) {
      els.deskMessage.textContent = activityError(error);
    }).then(function () {
      S.recoveryLoading = false;
      renderDesk();
    });
  }

  function loadTimeline() {
    return request(API + '/timeline', { timeout: 15000 }).then(function (data) {
      if (!data || data.ok === false) throw new Error('Bad timeline');
      S.timeline = data;
      if (S.deskTab === 'recovery' && S.desk) renderDesk();
    }).catch(function () {
      S.timeline = { ok: true, items: [], stats: { count: 0, avgMs: null, maxMs: null } };
    });
  }

  function performRollback(checkpoint) {
    if (S.activityBusy) return;
    S.activityBusy = true;
    els.deskMessage.textContent = '正在按检查点回滚…';
    renderDesk();
    request(API + '/rollback', { method: 'POST', body: JSON.stringify({ confirmed: true, checkpoint: checkpoint }), timeout: 120000 })
      .then(function (data) {
        S.rollbackConfirm = '';
        if (data.changed === false) els.deskMessage.textContent = '当前清单已经是这个状态，无需回滚。';
        else {
          var plan = data.plan || {};
          var parts = [];
          if ((plan.remove || []).length) parts.push('移除 ' + plan.remove.length);
          if ((plan.install || []).length) parts.push('重装 ' + plan.install.length);
          if ((plan.enable || []).length) parts.push('启用 ' + plan.enable.length);
          if ((plan.disable || []).length) parts.push('停用 ' + plan.disable.length);
          els.deskMessage.textContent = '回滚完成（' + (parts.join('、') || '无变化') + '），需要重启后生效。';
        }
        refreshAfterMutation();
      })
      .catch(function (error) {
        els.deskMessage.textContent = activityError(error);
      })
      .then(function () {
        S.activityBusy = false;
        renderDesk();
      });
  }

  function performSafeMode(action) {
    if (S.activityBusy) return;
    S.activityBusy = true;
    els.deskMessage.textContent = action === 'enter' ? '正在记录安全模式…' : '正在退出安全模式…';
    renderDesk();
    request(API + '/safe-mode', { method: 'POST', body: JSON.stringify({ action: action, confirmed: true }), timeout: 30000 })
      .then(function () {
        S.safeConfirm = false;
        els.deskMessage.textContent = action === 'enter' ? '已进入安全模式，重启后只剩官方插件。' : '已退出安全模式，请在设置里重新启用需要的插件。';
        refreshAfterMutation();
      })
      .catch(function (error) {
        els.deskMessage.textContent = activityError(error);
      })
      .then(function () {
        S.activityBusy = false;
        renderDesk();
      });
  }

  function performCleanup(paths) {
    if (S.activityBusy) return;
    S.activityBusy = true;
    els.deskMessage.textContent = '正在删除…';
    renderDesk();
    request(API + '/cleanup', { method: 'POST', body: JSON.stringify({ confirmed: true, paths: paths }), timeout: 60000 })
      .then(function (data) {
        S.cleanupConfirm = false;
        S.cleanupPick = Object.create(null);
        els.deskMessage.textContent = '已删除 ' + (data.deleted || []).length + ' 个残留目录。';
        refreshAfterMutation();
      })
      .catch(function (error) {
        els.deskMessage.textContent = activityError(error);
      })
      .then(function () {
        S.activityBusy = false;
        renderDesk();
      });
  }

  function refreshAfterMutation() {
    loadActivity();
    loadRecovery();
  }
  function loadActivity() {
    if (S.activityLoading) return Promise.resolve();
    S.activityLoading = true;
    els.deskMessage.textContent = '正在读取…';
    els.deskRefresh.disabled = true;
    return request(API + '/activity', { timeout: 15000 }).then(function (data) {
      if (!data || data.ok === false) throw new Error('Bad activity');
      S.activity = data;
      els.deskMessage.textContent = data.warning || '记录仅保存在本机';
    }).catch(function (error) {
      els.deskMessage.textContent = activityError(error);
    }).then(function () {
      S.activityLoading = false;
      renderDesk();
    });
  }

  function openDesk(tab) {
    if (S.restarting) return;
    if (!S.desk) rememberFocus();
    closePanel(false);
    S.desk = true;
    S.deskTab = tab || 'history';
    S.removeConfirm = '';
    S.rollbackConfirm = '';
    S.safeConfirm = false;
    S.cleanupConfirm = false;
    els.deskLayer.hidden = false;
    renderDesk();
    loadActivity();
    loadRecovery();
    try { els.desk.focus({ preventScroll: true }); } catch (err) {}
  }

  function closeDesk(returnFocus) {
    if (S.activityBusy && returnFocus !== false) return;
    S.desk = false;
    S.removeConfirm = '';
    els.deskLayer.hidden = true;
    if (returnFocus !== false) restoreFocus();
  }

  function performTrial(action, item) {
    if (S.activityBusy || S.activityLoading) return;
    S.activityBusy = true;
    renderDesk();
    els.deskMessage.textContent = action === 'remove' ? '正在由宿主管理器移除，请稍候…' : '正在保存…';
    var result;
    request(API + '/trials', { method: 'POST', timeout: 120000, body: JSON.stringify({
      action: action, name: item.name, id: item.id, version: item.version, confirmed: action === 'remove'
    }) }).then(function (data) {
      result = data;
      S.removeConfirm = '';
      return loadActivity();
    }).then(function () {
      els.deskMessage.textContent = result && result.restartRequired ? '已移除，宿主提示需要重启。' : '操作完成';
    }).catch(function (error) {
      els.deskMessage.textContent = activityError(error);
    }).then(function () {
      S.activityBusy = false;
      renderDesk();
      pollOnce(true);
    });
  }

  function trialPendingGroup() {
    if (!S.pending || S.busy) return;
    var packages = (S.pending.packages || []).filter(function (p) { return p.name !== 'dsh-bingo-ren'; });
    if (!packages.length) return;
    var signature = S.pending.signature;
    S.busy = true;
    render();
    var sequence = Promise.resolve();
    packages.forEach(function (pkg) {
      sequence = sequence.then(function () {
        return request(API + '/trials', { method: 'POST', body: JSON.stringify({ action: 'start', name: pkg.name, version: pkg.version }) });
      });
    });
    sequence.then(function () {
      S.busy = false;
      if (S.pending && S.pending.signature === signature) {
        dismissPending('trial');
        openDesk('trials');
      } else {
        render();
        live('原有插件已标记试用，另有新的插件待处理');
      }
    }).catch(function (error) {
      S.busy = false;
      closeDialog(false);
      openPanel();
      showError(activityError(error));
      render();
    });
  }

  function trapTab(event) {
    var container = S.desk ? els.desk : els.dialog;
    var nodes = container.querySelectorAll('button:not([disabled]), select:not([disabled])');
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    var active = activeElement();
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKeyDown(event) {
    var key = event.key || '';
    if ((event.ctrlKey || event.metaKey) && event.altKey && (key === 'b' || key === 'B' || event.code === 'KeyB')) {
      if (S.restarting) return;
      event.preventDefault();
      if (S.desk) { closeDesk(); return; }
      togglePanel();
      return;
    }
    if (key === 'Escape' || key === 'Esc') {
      if (S.desk) { event.preventDefault(); closeDesk(); return; }
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
    if (key === 'Tab' && (S.dialog || S.desk)) trapTab(event);
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

  function onPillPointerDown(event) {
    if (S.restarting || S.busy) return;
    if (event.button !== undefined && event.button !== 0) return;
    var rect = els.pill.getBoundingClientRect();
    S.drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false
    };
    try {
      els.pill.setPointerCapture(event.pointerId);
    } catch (err) {}
  }

  function onPillPointerMove(event) {
    if (!S.drag || event.pointerId !== S.drag.id) return;
    var dx = event.clientX - S.drag.startX;
    var dy = event.clientY - S.drag.startY;
    if (!S.drag.moved && Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) {
      S.drag.moved = true;
      if (host) host.classList.add('is-dragging');
      closePanel(false);
    }
    if (!S.drag.moved) return;
    S.edge = null;
    setPosition(S.drag.originX + dx, S.drag.originY + dy, false);
    if (event.cancelable) event.preventDefault();
  }

  function finishDrag(event, cancel) {
    var drag = S.drag;
    if (!drag || (event && event.pointerId !== drag.id)) return;
    S.drag = null;
    try {
      els.pill.releasePointerCapture(drag.id);
    } catch (err) {}
    if (host) host.classList.remove('is-dragging');
    if (!drag.moved) return;
    S.posUser = true;
    S.suppressClick = true;
    window.setTimeout(function () {
      S.suppressClick = false;
    }, 60);
    if (cancel) {
      if (S.pos) setPosition(S.pos.x, S.pos.y, true);
      return;
    }
    snapToEdges();
  }

  function bind() {
    els.manage.addEventListener('click', function () { openDesk('history'); });
    els.tryGroup.addEventListener('click', trialPendingGroup);
    els.deskClose.addEventListener('click', function () { closeDesk(); });
    els.deskRefresh.addEventListener('click', function () {
      loadActivity();
      loadRecovery();
    });
    els.deskLayer.addEventListener('pointerdown', function (event) { if (event.target === els.deskLayer) closeDesk(); });
    ['history', 'trials', 'recovery', 'checks'].forEach(function (tab) {
      els[tab + 'Tab'].addEventListener('click', function () {
        if (S.activityBusy) return;
        S.deskTab = tab;
        S.removeConfirm = '';
        S.safeConfirm = false;
        S.cleanupConfirm = false;
        if (tab === 'recovery' && !S.recovery) loadRecovery();
        renderDesk();
      });
    });
    els.pill.addEventListener('click', function (event) {
      if (S.suppressClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      togglePanel();
    });
    els.pill.addEventListener('pointerdown', onPillPointerDown);
    els.pill.addEventListener('pointermove', onPillPointerMove);
    els.pill.addEventListener('pointerup', function (event) {
      finishDrag(event, false);
    });
    els.pill.addEventListener('pointercancel', function (event) {
      finishDrag(event, true);
    });
    els.pill.addEventListener('dragstart', function (event) {
      event.preventDefault();
    });
    window.addEventListener('resize', onResize);
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
    window.__DSH_BINGO__ = { openPanel: openPanel, openManager: openDesk };
  }

  function mount() {
    if (document.getElementById('dsh-bingo-host')) return;
    host = document.createElement('div');
    host.id = 'dsh-bingo-host';
    host.setAttribute('data-dsh-bingo', '');
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
      initPosition();
      pollOnce(true);
      // Re-apply once layout has settled: the first read can still see the
      // 120px fallback width, which would clamp a saved right-edge position
      // short of the edge. A timer (not rAF) also works in hidden/headless pages.
      window.setTimeout(function () {
        if (S.drag) return;
        var saved = readSavedPosition();
        if (saved) setPosition(saved.x, saved.y, false);
        else initPosition();
      }, 60);
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
