/**
 * `scripts/perf-render.html` を Chromium で開いて、描画の計測結果を拾う。
 *
 *   npm i -D playwright-core   # 常設の依存にはしない（計測のときだけ要る）
 *   npx tsx scripts/perf-render-run.ts            # S30 ★10 ×6, dpr 1
 *   npx tsx scripts/perf-render-run.ts S30 10 6 2   # 高精細（スマホ相当）
 *
 * ブラウザの実体は環境の Chromium を使う（`CHROMIUM_PATH` で差し替え可）。
 * playwright-core が入っていなければ、手で開く手順を出して終わる ――
 * **計測できないときに黙って 0 を返さない**。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const [stage = 'S30', star = '10', factor = '6', dpr = '1'] = process.argv.slice(2);
const PORT = 5199;
const url = `http://localhost:${PORT}/scripts/perf-render.html?stage=${stage}&star=${star}&factor=${factor}`;

function chromiumPath(): string | null {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter((p): p is string => typeof p === 'string');
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * playwright-core は**常設の依存にしない**ので、型もここで最小限だけ書く。
 * `import type` を書くと入っていない環境で型チェックが落ちる
 */
interface PerfPage {
  on(event: 'pageerror', handler: (error: Error) => void): void;
  goto(url: string, options: { waitUntil: 'load' }): Promise<unknown>;
  waitForFunction(expr: string, arg: null, options: { timeout: number }): Promise<unknown>;
  textContent(selector: string): Promise<string | null>;
}
interface PerfBrowser {
  newPage(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
  }): Promise<PerfPage>;
  close(): Promise<void>;
}
interface PerfChromium {
  launch(options: { executablePath: string }): Promise<PerfBrowser>;
}

async function main(): Promise<void> {
  let chromium: PerfChromium;
  try {
    // **モジュール名を変数に逃がす。** ここへ直接文字列を書くと
    // `tsc --noEmit` が解決を試み、入っていない環境（CI）で型エラーになる。
    // 入っていないのが正常な依存なので、型の側でも解決させない
    const spec = 'playwright-core';
    ({ chromium } = (await import(spec)) as unknown as { chromium: PerfChromium });
  } catch {
    console.error('playwright-core が入っていません。');
    console.error('  npm i -D playwright-core');
    console.error(`または開発サーバーを立てて手で開いてください:\n  npm run dev\n  ${url}`);
    process.exitCode = 1;
    return;
  }

  const exe = chromiumPath();
  if (!exe) {
    console.error('Chromium が見つかりません。CHROMIUM_PATH を指定してください');
    process.exitCode = 1;
    return;
  }

  // **プロセスグループごと起動する。** `npx` を kill しても子の vite は
  // 生き残り、次の計測が「ポートが埋まっている」で落ちる（実際に踏んだ）
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: true,
  });
  const stopVite = (): void => {
    if (vite.pid) {
      try {
        process.kill(-vite.pid, 'SIGKILL');
      } catch {
        vite.kill('SIGKILL');
      }
    }
  };
  process.on('exit', stopVite);
  // dev サーバーが listen するまで待つ。固定の sleep だと遅い環境で落ちる
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite が起動しませんでした')), 60_000);
    vite.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready in') || chunk.toString().includes('Local:')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  const browser = await chromium.launch({ executablePath: exe });
  try {
    // **dpr を上げて測る意味がある。** 描画は塗るピクセル数で効くので、
    // dpr 1 の数字だけ見て「余裕がある」と言うと、Retina のスマホで外す
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: Number(dpr),
    });
    page.on('pageerror', (error) => console.error('page error:', error.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction('window.__perfDone === true', null, { timeout: 300_000 });
    console.log(await page.textContent('#out'));
  } finally {
    await browser.close();
    stopVite();
  }
}

void main();
