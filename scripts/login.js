import puppeteer from 'puppeteer';
import axios from 'axios';

async function sendTelegramMessage(botToken, chatId, message) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Telegram 通知失败:', error.message);
  }
}

async function login() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
  const page = await browser.newPage();

  // 伪装指纹
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    const targetUrl = process.env.WEBSITE_URL || 'https://lunes.me/login'; // 如果环境变量没填，请修改此处默认值
    console.log('正在访问:', targetUrl);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('填写表单...');
    await page.type('#email', process.env.LUNES_USERNAME);
    await page.type('#password', process.env.LUNES_PASSWORD);

    // 等待 15 秒让 Cloudflare 尝试自动静默验证
    console.log('等待 Cloudflare 验证...');
    await new Promise(r => setTimeout(r, 15000));

    console.log('提交登录...');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null)
    ]);

    const finalUrl = page.url();
    const title = await page.title();

    if (finalUrl !== targetUrl && !title.includes('Login')) {
      await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, `✅ *登录成功！*\n页面: ${finalUrl}`);
      console.log('登录成功');
    } else {
      throw new Error(`登录未跳转，可能被验证码拦截。当前 URL: ${finalUrl}`);
    }

  } catch (error) {
    console.error('错误:', error.message);
    await page.screenshot({ path: 'login-failure.png', fullPage: true });
    await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, `❌ *登录失败*\n原因: ${error.message}`);
    throw error;
  } finally {
    await browser.close();
  }
}

login();
