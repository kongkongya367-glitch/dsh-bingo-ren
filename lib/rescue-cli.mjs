#!/usr/bin/env node
/** Works from the independent local copy even when the Harness GUI cannot open. */
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { createRescue } from './rescue.js';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const profileDir = option('--profile') || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'desktop');
const stateDir = option('--state') || process.env.DSH_BINGO_HOME || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'bingo');
let command = args[0] || 'status';
const messages = {
  'application-still-running': '请完全退出 Harness 后再操作。', 'profile-busy': 'profile 正被其他操作占用，请稍后重试。',
  'configuration-changed': '配置已被修改，已停止恢复以保留这些改动。请核对备份并手动合并。',
  'unsupported-profile-layout': '未识别到标准桌面基础包，未修改此 profile。', 'no-rescue-backup': '没有可恢复的最小启动备份。'
};
try {
  const rescue = createRescue({ profileDir, stateDir });
  if (command === 'menu') {
    console.log('Bingo 离线急救\n请先完全退出 Harness。备份与恢复不需要打开应用界面。');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const choice = await rl.question('1 = 最小启动；2 = 恢复原配置；其他 = 查看状态：'); rl.close();
    command = choice === '1' ? 'enter' : choice === '2' ? 'restore' : 'status';
    if (command !== 'status') args.push('--closed', '--apply');
  }
  if (command === 'status') console.log(JSON.stringify(rescue.summary(), null, 2));
  else if (['enter', 'restore'].includes(command)) {
    if (!args.includes('--closed') || !args.includes('--apply')) throw new Error('请先关闭应用，再加 --closed --apply 执行；status 可只读查看状态。');
    if (process.platform === 'win32') {
      const shell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const output = execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', "@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^DeepSeek[ -]?Harness$|^dsh-desktop' } | Select-Object -ExpandProperty Id) | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true });
      const pids = output.trim() ? JSON.parse(output) : [];
      if ([].concat(pids).some(pid => pid !== process.pid)) throw Object.assign(new Error('application-still-running'), { code: 'application-still-running' });
    }
    const task = rescue.prepare(command, { withoutBingo: args.includes('--without-bingo') });
    rescue.apply(task, { closed: true, ...rescue.session() });
    console.log(command === 'enter' ? '最小启动配置已准备好，现在可以手动打开 Harness。' : '原配置已恢复，现在可以手动打开 Harness。');
    console.log('备份目录：' + rescue.folder);
  } else throw new Error('命令：status | enter | restore | menu；可选 --profile <目录> --state <目录>');
} catch (error) {
  console.error(messages[error.code] || error.message); process.exitCode = 1;
}
