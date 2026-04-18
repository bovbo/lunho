import { chromium } from '@playwright/test';
import fs from 'fs';

// 目标地址
const LOGIN_URL = 'https://ctrl.lunes.host/auth/login';
const SERVER_ID = '67c5467e';

// Telegram 通知函数
async function notifyTelegram({ ok, stage, msg, screenshotPath }) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const text = [
      `🔔 Lunes 自动操作：${ok ? '✅ 成功' : '❌ 失败'}`,
      `阶段：${stage}`,
      msg ? `信息：${msg}` : '',
      `时间：${new Date().toLocaleString()}`
    ].filter(Boolean).join('\n');

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
    });

    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const photoUrl = `https://api.telegram.org/bot${token}/sendPhoto`;
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', `截图：${stage}`);
      form.append('photo', new Blob([fs.readFileSync(screenshotPath)]), 'screenshot.png');
      await fetch(photoUrl, { method: 'POST', body: form });
    }
  } catch (e) {
    console.log('[WARN] TG 通知失败：', e.message);
  }
}

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`环境变量 ${name} 未设置`);
  return v;
}

async function main() {
  const username = envOrThrow('LUNES_USERNAME');
  const password = envOrThrow('LUNES_PASSWORD');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const screenshot = (name) => `./${name}.png`;

  try {
    // 1) 访问登录页
    console.log('正在打开登录页...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // 2) 填写登录信息
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    
    const loginBtn = page.locator('button[type="submit"]');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      loginBtn.click()
    ]);

    // 3) 检查登录状态
    const url = page.url();
    const isSuccess = await page.locator('text=/Dashboard|Logout|控制台|面板/i').first().count() > 0 || !url.includes('/auth/login');

    if (isSuccess) {
      console.log('登录成功，进入服务器详情...');
      
      // 直接跳转到服务器 ID 页面，比点击链接更稳
      await page.goto(`https://ctrl.lunes.host/server/${SERVER_ID}`, { waitUntil: 'networkidle' });
      
      const spServer = screenshot('04-server-page');
      await page.screenshot({ path: spServer });
      await notifyTelegram({ ok: true, stage: '进入服务器页', msg: `已进入服务器 ${SERVER_ID}`, screenshotPath: spServer });

      // 4) 点击 Restart 按钮
      console.log('点击 Restart...');
      const restartBtn = page.locator('button:has-text("Restart")');
      await restartBtn.waitFor({ state: 'visible', timeout: 15000 });
      await restartBtn.click();
      await notifyTelegram({ ok: true, stage: '重启操作', msg: '已触发 Restart 按钮' });

      // 等待重启缓冲
      await page.waitForTimeout(10000);

      // 5) 输入命令
      console.log('执行命令...');
      const commandInput = page.locator('input[placeholder*="Type a command"]');
      if (await commandInput.count() > 0) {
        await commandInput.fill('working properly');
        await commandInput.press('Enter');
        await page.waitForTimeout(5000);
        
        const spCmd = screenshot('05-command-done');
        await page.screenshot({ path: spCmd });
        await notifyTelegram({ ok: true, stage: '命令执行', msg: '指令已下发', screenshotPath: spCmd });
      }

      process.exitCode = 0;
    } else {
      throw new Error('登录后仍停留在登录页面');
    }

  } catch (e) {
    console.error('发生异常:', e.message);
    const spErr = screenshot('99-error');
    await page.screenshot({ path: spErr }).catch(() => {});
    await notifyTelegram({ ok: false, stage: '任务异常', msg: e.message, screenshotPath: spErr });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
