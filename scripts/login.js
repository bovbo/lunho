import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';

// 启用 Stealth 插件抹除自动化指纹，模拟真实环境
chromium.use(stealth());

// --- 工具函数：随机延迟 ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => delay(Math.floor(Math.random() * (max - min + 1) + min));

// --- 模拟真人行为：随机鼠标移动 & 滚动 ---
async function simulateHumanMovement(page) {
    console.log('正在执行模拟真人行为...');
    const size = page.viewportSize();
    // 随机移动鼠标
    for (let i = 0; i < 6; i++) {
        const x = Math.floor(Math.random() * size.width);
        const y = Math.floor(Math.random() * size.height);
        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
        await randomDelay(100, 300);
    }
    // 随机滚动页面
    await page.mouse.wheel(0, Math.floor(Math.random() * 400) + 100);
    await randomDelay(500, 1000);
}

// --- Telegram 通知系统 ---
async function notifyTelegram({ ok, stage, msg, screenshotPath }) {
    const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
    if (!token || !chatId) return;

    const text = `🔔 *Lunes 任务通知*\n状态: ${ok ? '✅ 成功' : '❌ 失败'}\n阶段: ${stage}\n详情: ${msg || '无'}\n时间: ${new Date().toLocaleString()}`;
    
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId, text, parse_mode: 'Markdown'
        });
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
    if (!apiKey) {
        console.log('未配置 CAPTCHA_API_KEY，尝试直接操作（若有 Turnstile 将失败）');
        return;
    }

    const sitekey = await page.evaluate(() => {
        const el = document.querySelector('.cf-turnstile') || document.querySelector('[data-sitekey]');
        return el ? el.getAttribute('data-sitekey') || el.dataset.sitekey : null;
    });

    if (!sitekey) {
        console.log('未检测到 Turnstile 验证码，继续执行');
        return;
    }

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
                if (window.turnstile) window.turnstile.render(); 
            }, token);
            console.log('Turnstile 验证码已成功注入');
            return;
        }
    }
    throw new Error('Turnstile 解析超时');
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });
    
    const page = await context.newPage();
    const screenshot = (name) => `./${name}.png`;

    try {
        // 1. 访问 Ctrl 登录页
        console.log('访问 Lunes Ctrl Login...');
        await page.goto('https://ctrl.lunes.host/auth/login', { waitUntil: 'load' });
        await simulateHumanMovement(page);
        
        await solveTurnstile(page, page.url());
        await randomDelay(1000, 2000);

        // 2. 模拟真人输入凭据
        console.log('输入账号密码...');
        await page.type('input[name="username"]', process.env.LUNES_USERNAME, { delay: Math.random() * 100 + 50 });
        await page.type('input[name="password"]', process.env.LUNES_PASSWORD, { delay: Math.random() * 100 + 50 });
        
        const loginBtn = page.locator('button[type="submit"]');
        await loginBtn.hover();
        await randomDelay(500, 1500);
        await loginBtn.click();

        // 3. 等待跳转至 Dashboard
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
        
        if (page.url().includes('/dashboard') || await page.locator('text=/Dashboard|Logout/i').count() > 0) {
            console.log('登录成功，开始执行 VPS 控制任务...');
            
            // --- 任务 A: 访问特定 VPS 详情页并下发重启指令 ---
            // 注意：此处 URL 根据你之前的代码保留为 https://ctrl.lunes.host/server/67c5467e
            await page.goto('https://ctrl.lunes.host/server/67c5467e', { waitUntil: 'networkidle' });
            await randomDelay(2000, 3000);
            
            console.log('下发 Restart 指令...');
            const restartBtn = page.locator('button:has-text("Restart")');
            if (await restartBtn.isVisible()) {
                await restartBtn.click();
                await delay(8000); // 等待 VPS 响应重启

                const cmdInput = page.locator('input[placeholder*="Type a command"]');
                if (await cmdInput.isVisible()) {
                    await cmdInput.fill('working properly');
                    await cmdInput.press('Enter');
                    console.log('指令已发送');
                }
            }

            // --- 任务 B: 访问 Betadash 服务器页面（这是为了满足 15 天登录的要求） ---
            console.log('正在前往 Betadash 特定服务器页面执行续期...');
            const targetServerUrl = 'https://betadash.lunes.host/servers/71745';
            await page.goto(targetServerUrl, { waitUntil: 'networkidle' });
            
            // 在此页面执行深度行为模拟以通过活跃检测
            await simulateHumanMovement(page);
            await randomDelay(4000, 8000); // 增加停留时间

            const sp = screenshot('success-complete');
            await page.screenshot({ path: sp, fullPage: true });
            
            await notifyTelegram({ 
                ok: true, 
                stage: '全流程完成', 
                msg: `VPS 已重启，Betadash 页面 (${targetServerUrl}) 已访问续期`, 
                screenshotPath: sp 
            });
        } else {
            throw new Error(`登录后未能进入 Dashboard，当前 URL: ${page.url()}`);
        }

    } catch (e) {
        console.error('发生错误:', e.message);
        const errSp = screenshot('error-log');
        await page.screenshot({ path: errSp, fullPage: true });
        await notifyTelegram({ ok: false, stage: '脚本异常', msg: e.message, screenshotPath: errSp });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

main();
