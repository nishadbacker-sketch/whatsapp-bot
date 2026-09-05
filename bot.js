const http = require('http');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');

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

// Helper function to query Shopify Admin API for Order Details
async function getShopifyOrderStatus(orderNumberClean) {
    const rawDomain = process.env.SHOPIFY_STORE_DOMAIN || 'shopexme.myshopify.com';
    const storeDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!accessToken) {
        return "⚠️ Order lookup is currently undergoing maintenance. Please contact support.";
    }

    try {
        const response = await axios.get(
            `https://${storeDomain}/admin/api/2024-07/orders.json`,
            {
                params: {
                    name: `#${orderNumberClean}`,
                    status: 'any'
                },
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            }
        );

        const orders = response.data.orders;
        if (!orders || orders.length === 0) {
            return `❌ Order #${orderNumberClean} was not found. Please double-check your order number and try again.`;
        }

        const order = orders[0];
        const financialStatus = order.financial_status ? order.financial_status.toUpperCase() : 'N/A';
        const fulfillmentStatus = order.fulfillment_status ? order.fulfillment_status.toUpperCase() : 'UNFULFILLED';
        const trackingUrl = order.fulfillments?.[0]?.tracking_url || null;

        let statusMessage = 
            `📦 *Order Details for #${orderNumberClean}*\n\n` +
            `🔹 *Payment Status:* ${financialStatus}\n` +
            `🔹 *Fulfillment Status:* ${fulfillmentStatus}\n` +
            `🔹 *Total Amount:* ₹${order.total_price}\n`;

        if (trackingUrl) {
            statusMessage += `\n🚚 *Track Your Package:* ${trackingUrl}`;
        } else {
            statusMessage += `\n⏳ Your order is being processed for dispatch. Tracking details will update soon!`;
        }

        return statusMessage;

    } catch (error) {
        console.error('Shopify API Error:', error?.response?.data || error.message);
        if (error?.response?.status === 404) {
            return "⚠️ Could not connect to Shopify store. Please check store domain or access token configuration.";
        }
        return "⚠️ Unable to fetch order status right now. Please try again later.";
    }
}

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
            }
        } else if (connection === 'open') {
            currentQr = '';
            console.log('✅ WhatsApp bot is connected and auto-reply is active!');
        }
    });

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
                const offerAndFormMessage = 
                    `Hi! 😊 Thank you for your interest / आपकी रुचि के लिए धन्यवाद!\n\n` +
                    `🚰 *Stainless Steel Faucet Storage Caddy / Organizer*\n` +
                    `💰 *Special Price:* ₹199 Only\n` +
                    `🚚 *Delivery:* Free Delivery\n` +
                    `💵 *Payment:* Cash on Delivery Available\n\n` +
                    `1️⃣ *Cash on Delivery (COD) Order:* Please reply with / कृपया भेजें:\n` +
                    `• *Name / नाम:*\n` +
                    `• *Mobile Number / मोबाइल नंबर:*\n` +
                    `• *Full Address / पूरा पता:*\n` +
                    `• *Pincode / पिनकोड:*\n` +
                    `• *Quantity / मात्रा:*\n\n` +
                    `2️⃣ *Online Order / ऑनलाइन ऑर्डर 🔒:*\n` +
                    `👉 https://www.shopexme.com/`;

                await sock.sendMessage(senderJid, { text: offerAndFormMessage });

                await sock.sendMessage(senderJid, {
                    image: { url: 'https://cdn.shopify.com/s/files/1/0958/8991/6205/files/IMG-4903.png?v=1788530733' },
                    caption: '📌 User Guide & Specifications (English)'
                });

                await sock.sendMessage(senderJid, {
                    image: { url: 'https://cdn.shopify.com/s/files/1/0958/8991/6205/files/IMG-4904.png?v=1788530733' },
                    caption: '📌 उपयोगकर्ता गाइड और विशेषताएँ (Hindi)'
                });
            } 
            // --- Order Status Inquiry Trigger ---
            else if (text.startsWith('#') || /^#?\d{4,6}$/.test(text)) {
                const orderNumberClean = text.replace('#', '').trim();
                await sock.sendMessage(senderJid, { text: `🔍 Checking status for Order #${orderNumberClean}...` });
                
                const statusMessage = await getShopifyOrderStatus(orderNumberClean);
                await sock.sendMessage(senderJid, { text: statusMessage });
            }
            // --- Standard Menu / Greeting ---
            else if (['hi', 'hello', 'hey', 'menu', 'start'].includes(text)) {
                const welcomeMenu = 
                    `👋 *Welcome to Shopex Support!*\n\n` +
                    `Reply with an option:\n` +
                    `1️⃣ View Store Catalog\n` +
                    `2️⃣ Check Order Status (Send your Order ID e.g., #1001)\n` +
                    `3️⃣ Store Details\n` +
                    `4️⃣ Talk to Support`;

                await sock.sendMessage(senderJid, { text: welcomeMenu });
            } 
            else if (text === '1') {
                await sock.sendMessage(senderJid, { 
                    text: `🛍️ Explore our catalog at https://www.shopexme.com` 
                });
            } 
            else if (text === '2') {
                await sock.sendMessage(senderJid, { 
                    text: `📦 Please reply with your order number (for example: *#1001* or *1001*).` 
                });
            } 
            else {
                await sock.sendMessage(senderJid, { 
                    text: `Type *hi* or *menu* to see options, or send your Order ID (e.g. #1001).` 
                });
            }
        }
    });
}

connectToWhatsApp();    if (!accessToken) {
        return "⚠️ Order lookup is currently undergoing maintenance. Please contact support.";
    }

    try {
        const response = await axios.get(
            `https://${storeDomain}/admin/api/2024-07/orders.json?name=%23${orderNumberClean}&status=any`,
            {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            }
        );

        const orders = response.data.orders;
        if (!orders || orders.length === 0) {
            return `❌ Order #${orderNumberClean} was not found. Please double-check your order number and try again.`;
        }

        const order = orders[0];
        const financialStatus = order.financial_status ? order.financial_status.toUpperCase() : 'N/A';
        const fulfillmentStatus = order.fulfillment_status ? order.fulfillment_status.toUpperCase() : 'UNFULFILLED';
        const trackingUrl = order.fulfillments?.[0]?.tracking_url || null;

        let statusMessage = 
            `📦 *Order Details for #${orderNumberClean}*\n\n` +
            `🔹 *Payment Status:* ${financialStatus}\n` +
            `🔹 *Fulfillment Status:* ${fulfillmentStatus}\n` +
            `🔹 *Total Amount:* ₹${order.total_price}\n`;

        if (trackingUrl) {
            statusMessage += `\n🚚 *Track Your Package:* ${trackingUrl}`;
        } else {
            statusMessage += `\n⏳ Your order is being processed for dispatch. Tracking details will update soon!`;
        }

        return statusMessage;

    } catch (error) {
        console.error('Shopify API Error:', error?.response?.data || error.message);
        return "⚠️ Unable to fetch order status right now. Please try again later.";
    }
}

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
            }
        } else if (connection === 'open') {
            currentQr = '';
            console.log('✅ WhatsApp bot is connected and auto-reply is active!');
        }
    });

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
                const offerAndFormMessage = 
                    `Hi! 😊 Thank you for your interest / आपकी रुचि के लिए धन्यवाद!\n\n` +
                    `🚰 *Stainless Steel Faucet Storage Caddy / Organizer*\n` +
                    `💰 *Special Price:* ₹199 Only\n` +
                    `🚚 *Delivery:* Free Delivery\n` +
                    `💵 *Payment:* Cash on Delivery Available\n\n` +
                    `1️⃣ *Cash on Delivery (COD) Order:* Please reply with / कृपया भेजें:\n` +
                    `• *Name / नाम:*\n` +
                    `• *Mobile Number / मोबाइल नंबर:*\n` +
                    `• *Full Address / पूरा पता:*\n` +
                    `• *Pincode / पिनकोड:*\n` +
                    `• *Quantity / मात्रा:*\n\n` +
                    `2️⃣ *Online Order / ऑनलाइन ऑर्डर 🔒:*\n` +
                    `👉 https://www.shopexme.com/`;

                await sock.sendMessage(senderJid, { text: offerAndFormMessage });

                await sock.sendMessage(senderJid, {
                    image: { url: 'https://cdn.shopify.com/s/files/1/0958/8991/6205/files/IMG-4903.png?v=1788530733' },
                    caption: '📌 User Guide & Specifications (English)'
                });

                await sock.sendMessage(senderJid, {
                    image: { url: 'https://cdn.shopify.com/s/files/1/0958/8991/6205/files/IMG-4904.png?v=1788530733' },
                    caption: '📌 उपयोगकर्ता गाइड और विशेषताएँ (Hindi)'
                });
            } 
            // --- Order Status Inquiry Trigger ---
            else if (text.startsWith('#') || /^#?\d{4,6}$/.test(text)) {
                const orderNumberClean = text.replace('#', '').trim();
                await sock.sendMessage(senderJid, { text: `🔍 Checking status for Order #${orderNumberClean}...` });
                
                const statusMessage = await getShopifyOrderStatus(orderNumberClean);
                await sock.sendMessage(senderJid, { text: statusMessage });
            }
            // --- Standard Menu / Greeting ---
            else if (['hi', 'hello', 'hey', 'menu', 'start'].includes(text)) {
                const welcomeMenu = 
                    `👋 *Welcome to Shopex Support!*\n\n` +
                    `Reply with an option:\n` +
                    `1️⃣ View Store Catalog\n` +
                    `2️⃣ Check Order Status (Send your Order ID e.g., #1001)\n` +
                    `3️⃣ Store Details\n` +
                    `4️⃣ Talk to Support`;

                await sock.sendMessage(senderJid, { text: welcomeMenu });
            } 
            else if (text === '1') {
                await sock.sendMessage(senderJid, { 
                    text: `🛍️ Explore our catalog at https://www.shopexme.com` 
                });
            } 
            else if (text === '2') {
                await sock.sendMessage(senderJid, { 
                    text: `📦 Please reply with your order number (for example: *#1001* or *1001*).` 
                });
            } 
            else {
                await sock.sendMessage(senderJid, { 
                    text: `Type *hi* or *menu* to see options, or send your Order ID (e.g. #1001).` 
                });
            }
        }
    });
}

connectToWhatsApp();
