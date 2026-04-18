import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';

// 启用 Stealth 插件抹除自动化指纹
chromium.use(stealth());

// --- 工具函数：随机延迟 ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => delay(Math.floor(Math.random() * (max - min + 1) + min));

// --- 模拟真人行为：随机鼠标移动 ---
async function simulateHumanMovement(page) {
    const size = page.viewportSize();
    for (let i = 0; i < 8; i++) {
        const x = Math.floor(Math.random() * size.width);
        const y = Math.floor(Math.random() * size.height);
        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 15) + 5 });
        await randomDelay(100, 400);
    }
}

// --- Telegram 通知系统 ---
async function notifyTelegram({ ok, stage, msg, screenshotPath }) {
    const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
    if (!token || !chatId) return;

    const text = `🔔 *Lunes 任务通知*\n状态: ${ok ? '✅ 成功' : '❌ 失败'}\n阶段: ${stage}\n详情: ${msg || '无'}\n时间: ${new Date().toLocaleString()}`;
    
    try {
        // 发送文字
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId, text, parse_mode: 'Markdown'
        });
        // 发送截图
        if (screenshotPath && fs.existsSync(screenshotPath)) {
            const form = new FormData();
            form.append('chat_id', chatId);
            form.append('photo', fs.createReadStream(screenshotPath));
            await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, form, { headers: form.getHeaders() });
        }
    } catch (e) { console.error('TG通知失败:', e.message); }
}

// --- 2Captcha 过 Cloudflare Turnstile ---
async function solveTurnstile(page, url) {
    const apiKey = process.env.CAPTCHA_API_KEY;
    if (!apiKey) throw new Error('未配置 CAPTCHA_API_KEY');

    // 获取 Sitekey
    const sitekey = await page.evaluate(() => {
        const el = document.querySelector('.cf-turnstile') || document.querySelector('[data-sitekey]');
        return el ? el.getAttribute('data-sitekey') || el.dataset.sitekey : null;
    });

    if (!sitekey) return console.log('未检测到 Turnstile，尝试直接操作');

    console.log('正在请求 2Captcha 解析 Turnstile...');
    const res = await axios.post('http://2captcha.com/in.php', {
        key: apiKey, method: 'turnstile', sitekey, pageurl: url, json: 1
    });

    const taskId = res.data.request;
    for (let i = 0; i < 30; i++) {
        await delay(5000);
        const check = await axios.get(`http://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`);
        if (check.data.status === 1) {
            const token = check.data.request;
            await page.evaluate((t) => {
                const input = document.querySelector('input[name="cf-turnstile-response"]');
                if (input) input.value = t;
                if (window.cfCallback) window.cfCallback();
                if (window.turnstile) window.turnstile.render(); // 强制触发回调
            }, token);
            console.log('Turnstile 验证已注入');
            return;
        }
    }
    throw new Error('Turnstile 解析超时');
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    // 关键：模拟真实 Windows Chrome 指纹
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York'
    });
    
    const page = await context.newPage();
    const screenshot = (name) => `./${name}.png`;

    try {
        // 1. 访问登录页
        console.log('访问 Lunes Login...');
        await page.goto('https://ctrl.lunes.host/auth/login', { waitUntil: 'load' });
        await simulateHumanMovement(page);
        
        // 2. 检测并过验证
        await solveTurnstile(page, page.url());
        await randomDelay(1000, 2000);

        // 3. 模拟真人输入
        console.log('输入凭据...');
        await page.type('input[name="username"]', process.env.LUNES_USERNAME, { delay: Math.random() * 100 + 50 });
        await page.type('input[name="password"]', process.env.LUNES_PASSWORD, { delay: Math.random() * 100 + 50 });
        
        const loginBtn = page.locator('button[type="submit"]');
        await loginBtn.hover();
        await randomDelay(500, 1500);
        await loginBtn.click();

        // 4. 等待登录成功跳转
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
        
        if (page.url().includes('/dashboard') || await page.locator('text=/Dashboard|Logout/i').count() > 0) {
            console.log('登录成功！开始执行服务器任务...');
            
            // 5. 服务器自动化流程
            await page.goto('https://ctrl.lunes.host/server/71745', { waitUntil: 'networkidle' });
            await randomDelay(2000, 4000);
            
            // 点击 Restart
            const restartBtn = page.locator('button:has-text("Restart")');
            await restartBtn.click();
            console.log('已下发 Restart 指令');
            await delay(10000); // 等待重启引导

            // 输入指令
            const cmdInput = page.locator('input[placeholder*="Type a command"]');
            await cmdInput.fill('working properly');
            await cmdInput.press('Enter');
            await delay(5000);

            const sp = screenshot('final-success');
            await page.screenshot({ path: sp, fullPage: true });
            await notifyTelegram({ ok: true, stage: '完整流程完成', msg: '账号登录成功且服务器已执行重启及指令', screenshotPath: sp });
        } else {
            throw new Error(`未能进入 Dashboard，当前 URL: ${page.url()}`);
        }

    } catch (e) {
        const sp = screenshot('error-log');
        await page.screenshot({ path: sp, fullPage: true });
        await notifyTelegram({ ok: false, stage: '脚本异常', msg: e.message, screenshotPath: sp });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

main();
