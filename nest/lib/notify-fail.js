import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';

// 失败报警(2026-09-17 加,mini 定时任务「失败不出声」统一排查)。两条扭蛋共用。
// 走 cobbler-notify.sh 而不是本仓的 tg-send.js:它自带代理回退(2026-09-10 加),
// 卡片本身直连 api.telegram.org 被 reset 时(book.log 里 3 次 ECONNRESET 就是这形态)报警仍能出去。
// 绝不抛:报警自己发不出去只记一行日志,不能把「卡片失败」再叠一层「报警失败」的异常。
const pexec = promisify(execFile);

// mini 上 os.hostname() 是 mac-mini.local,报警标题只要 mac-mini(与 bash 脚本的 hostname -s 一致)
export function shortHostname() {
  return hostname().replace(/\.local$/, '');
}

// 错误信息取第一行、截 200 字:报警在手机上看,栈太长没意义,全文在日志里
export function firstLine(e, max = 200) {
  return String(e?.message ?? e).split('\n')[0].slice(0, max);
}

export async function notifyFailure(text, opts = {}) {
  const bin = opts.bin ?? process.env.COBBLER_NOTIFY_BIN
    ?? `${process.env.HOME}/Downloads/sync-bridge/scripts-bin/cobbler-notify.sh`;
  const log = opts.log ?? console.error;
  try {
    await pexec('bash', [bin, text], { timeout: opts.timeout ?? 60000 });
    return true;
  } catch (e) {
    // 非零退出 → e.code 是退出码(cobbler-notify:1 发送失败 / 2 用法错 / 3 缺凭证);
    // 超时被杀 → code 为 null,标出信号;起不来 → ENOENT 之类
    const why = e?.killed ? `超时被杀 ${e.signal}` : (e?.code ?? e?.message);
    log(`[notify] TG 报警发送失败(cobbler-notify 退出码 ${why})`);
    return false;
  }
}
