const http = require('http');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

let currentQr = '';

// Web Server for Render Keep-Alive & QR Page
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (currentQr) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Scan WhatsApp QR Code</title></head>
        <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;background:#0f172a;color:#fff;font-family:sans-serif;">
          <h2>Scan with WhatsApp</h2>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQr)}" style="border:10px solid #fff;border-radius:8px;" />
          <p style="margin-top:15px;color:#94a3b8;">Refresh page if code expires</p>
        </body>
      </html>
    `);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2 style="font-family:sans-serif;text-align:center;margin-top:20%;">WhatsApp Bot is active!</h2>');
  }
}).listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Mac OS', 'Chrome', '12.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQr = qr;
            console.log('⚡ New QR Code generated. View it in browser!');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Connection closed (Reason: ${statusCode}). Reconnecting: ${shouldReconnect}`);

            if (shouldReconnect) {
                setTimeout(() => {
                    connectToWhatsApp();
                }, 3000);
            } else {
                console.log('Logged out.');
            }
        } else if (connection === 'open') {
            currentQr = '';
            console.log('✅ WhatsApp bot is connected and auto-reply is active!');
        }
    });

    // Handle Incoming Messages
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            if (msg.key.fromMe) continue;

            const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            const text = rawText.trim().toLowerCase();
            const senderJid = msg.key.remoteJid;

            if (!text) continue;

            console.log(`📩 Message from ${senderJid}: "${rawText}"`);

            // --- Meta Ad Lead Auto-Reply ---
            if (text.includes('hello! can i get more info on this') || text.includes('can i get more info')) {
                const detailsText = 
                    `👋 *Thank you for reaching out to Shopex!*\n\n` +
                    `🚰 *Stainless Steel Faucet Storage Caddy / Organizer*\n\n` +
                    `💰 *Price:* ₹199 Only\n` +
                    `🚚 *Delivery:* Free Delivery\n` +
                    `💵 *Payment:* Cash on Delivery Available\n\n` +
                    `✅ Durable Stainless Steel Design\n` +
                    `✅ Rust Resistant & Easy to Install\n` +
                    `✅ Fits Round Faucet Pipes (up to 2.5 cm diameter)\n\n` +
                    `👇 *Check the size, compatibility & installation guide below (English & Hindi):*`;

                // 1. Send Text Details & Price
                await sock.sendMessage(senderJid, { text: detailsText });

                // 2. Send First Image (English Guide)
                await sock.sendMessage(senderJid, {
                    image: { url: 'https://cdn.shopify.com/s/files/1/0958/8991/6205/files/IMG-4903.png?v=1788530733' },
                    caption: '📌 Faucet Storage Caddy - User Guide & Specifications (English)'
                });

                // 3. Send Second Image (Hindi Guide)
                await sock.sendMessage(senderJid, {
                    image: { url: 'https://cdn.shopify.com/s/files/1/0958/8991/6205/files/IMG-4904.png?v=1788530733' },
                    caption: '📌 फ़ॉसेट स्टोरेज कैडी - उपयोगकर्ता गाइड और विशेषताएँ (Hindi)'
                });
            } 
            // --- Standard Menu / Greeting ---
            else if (['hi', 'hello', 'hey', 'menu', 'start'].includes(text)) {
                const welcomeMenu = 
                    `👋 *Welcome to Shopex Support!*\n\n` +
                    `Reply with an option:\n` +
                    `1️⃣ View Store Catalog\n` +
                    `2️⃣ Check Order Status\n` +
                    `3️⃣ Store Details\n` +
                    `4️⃣ Talk to Support`;

                await sock.sendMessage(senderJid, { text: welcomeMenu });
            } 
            else if (text === '1') {
                await sock.sendMessage(senderJid, { 
                    text: `🛍️ Explore our catalog at https://shopexme.com` 
                });
            } 
            else {
                await sock.sendMessage(senderJid, { 
                    text: `Type *hi* or *menu* to see options.` 
                });
            }
        }
    });
}

connectToWhatsApp();
