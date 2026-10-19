import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const clientJs = readFileSync(join(root, 'client/bingo-client.js'), 'utf8');
const clientCss = readFileSync(join(root, 'client/bingo-client.css'), 'utf8');
const preview = readFileSync(join(root, 'preview/index.html'), 'utf8');

test('client js parses and is a strict guarded IIFE', () => {
  assert.doesNotThrow(() => new Function(clientJs));
  assert.match(clientJs, /^\/\*! dsh-bingo-restart/);
  assert.match(clientJs, /'use strict'/);
  assert.match(clientJs, /__DSH_BINGO_LOADED__/);
});

test('client implements the host contract', () => {
  for (const marker of [
    'attachShadow',
    'dsh-bingo-host',
    "'/bingo'",
    "'/status'",
    "'/restart'",
    "'/dismiss'",
    'AbortController',
    'visibilitychange',
    'data-ds-theme-source',
    'prefers-reduced-motion',
    'dsh-bingo:ready',
    'localStorage',
    'pointerdown',
    'is-snapping',
    'snapToEdges',
    'SNAP_THRESHOLD'
  ]) {
    assert.ok(clientJs.includes(marker) || clientCss.includes(marker), 'missing ' + marker);
  }
});

test('client supports both themes, pending dialog and restart layer', () => {
  assert.match(clientCss, /:host/);
  assert.ok(clientCss.includes('prefers-color-scheme'));
  assert.ok(clientCss.includes('data-theme="dark"'));
  assert.ok(clientJs.includes('Bingo 一下'));
  assert.ok(clientJs.includes('立即 Bingo'));
  assert.ok(clientJs.includes('正在重启 Harness'));
});

test('client avoids forbidden browser APIs and frameworks', () => {
  assert.doesNotMatch(clientJs, /\balert\s*\(/);
  assert.doesNotMatch(clientJs, /\bconfirm\s*\(/);
  assert.doesNotMatch(clientJs, /\bprompt\s*\(/);
  assert.doesNotMatch(clientJs, /\bReact\b/);
});

test('client assets stay below the 38 KB budget', () => {
  const total = statSync(join(root, 'client/bingo-client.js')).size + statSync(join(root, 'client/bingo-client.css')).size;
  assert.ok(total < 38000, 'client js+css is ' + total + ' bytes');
});

test('preview mocks fetch and exposes every screenshot scene', () => {
  assert.ok(preview.includes('window.fetch = function'));
  assert.ok(preview.includes('__DSH_BINGO_CLIENT_CSS__'));
  assert.ok(preview.includes('dsh-bingo:ready'));
  for (const scene of ['button', 'panel', 'pending', 'restarting', 'web']) {
    assert.ok(preview.includes("'" + scene + "'"), 'missing scene ' + scene);
  }
  assert.ok(existsSync(join(root, 'preview/src/bingo-client.js')));
  assert.ok(existsSync(join(root, 'preview/src/bingo-client.css')));
  assert.ok(existsSync(join(root, 'preview/build.mjs')));
});

test('required screenshots exist', () => {
  for (const name of ['screenshot-button.png', 'screenshot-panel.png', 'screenshot-new-plugin.png', 'screenshot-dragged.png']) {
    assert.ok(existsSync(join(root, 'assets', name)), 'missing ' + name);
  }
});

test('generated files point back at their readable sources', () => {
  assert.ok(clientJs.includes('preview/src'));
  assert.ok(clientCss.includes('preview/src'));
});