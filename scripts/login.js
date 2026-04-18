const puppeteer = require('puppeteer');
const axios = require('axios');

async function sendTelegramMessage(botToken, chatId, message) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await axios.post(url, {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown'
  }).catch(error => {
    console.error('Telegram 通知失败:', error.message);
  });
}

// 替换掉原来的 2Captcha 逻辑
async function tryAutoSolveTurnstile(page) {
  console.log('正在等待验证码加载（尝试自动通过）...');
  
  // 给 Cloudflare 5-10 秒的时间进行自动环境检测（打钩）
  // 这种方法不花钱，主要靠 Page 的伪装和运气
  await new Promise(resolve => setTimeout(resolve, 10000)); 

  // 尝试寻找验证码 iframe 并点击（可选逻辑）
  try {
    const frames = page.frames();
    const turnstileFrame = frames.find(f => f.url().includes('turnstile') || f.url().includes('challenge'));
    if (turnstileFrame) {
      console.log('检测到验证码容器，尝试等待其自动完成...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (e) {
    console.log('未检测到可点击的验证码框或已自动通过');
  }
}

async function login() {
  const browser = await puppeteer.launch({
    headless: "new", // 建议使用 new 模式
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=3440,1440'
    ]
  });
  const page = await browser.newPage();

  // 伪装浏览器指纹，增加不花钱过验证的概率
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    console.log('正在访问登录页面...');
    await page.goto(process.env.WEBSITE_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('输入账号密码...');
    await page.type('#email', process.env.LUNES_USERNAME); // 确保变量名与 Secrets 一致
    await page.type('#password', process.env.LUNES_PASSWORD);

    // 调用“白嫖”逻辑，等待验证码自行解决
    await tryAutoSolveTurnstile(page);

    console.log('尝试提交登录表单...');
    // 使用 Promise.all 捕获可能的页面跳转
    await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null)
    ]);

    const currentUrlAfter = page.url();
    const title = await page.title();

    // 判断逻辑：如果 URL 变了，或者标题不再包含 Login
    if (currentUrlAfter !== process.env.WEBSITE_URL && !title.includes('Login')) {
      await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, `*登录成功！*\n时间: ${new Date().toLocaleString()}\n页面: ${currentUrlAfter}\n标题: ${title}`);
      console.log('登录成功！当前页面：', currentUrlAfter);
    } else {
      throw new Error(`仍停留在登录页，可能是验证码未通过。URL: ${currentUrlAfter}`);
    }

  } catch (error) {
    console.error('登录失败：', error.message);
    await page.screenshot({ path: 'login-failure.png', fullPage: true });
    await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, `*登录失败！*\n时间: ${new Date().toLocaleString()}\n错误: ${error.message}\n请检查截图。`);
    throw error;
  } finally {
    await browser.close();
  }
}

login();
