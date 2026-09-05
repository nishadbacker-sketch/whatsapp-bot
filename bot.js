const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const http = require('http');

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
            <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
                <h2>Scan QR Code to Connect WhatsApp</h2>
                <img src="https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(currentQr)}&size=300x300" />
            </body>
            </html>
        `);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('WhatsApp bot is running and connected!');
    }
}).listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

// Helper to get OAuth Access Token dynamically from Shopify
async function getShopifyAccessToken() {
    const rawDomain = process.env.SHOPIFY_STORE_DOMAIN || 'shopex2.myshopify.com';
    const storeDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET");
    }

    const response = await axios.post(
        `https://${storeDomain}/admin/oauth/access_token`,
        {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        },
        {
            headers: { 'Content-Type': 'application/json' }
        }
    );

    return response.data.access_token;
}

// Function to fetch Shopify Order Status
async function getShopifyOrderStatus(orderNumberClean) {
    const rawDomain = process.env.SHOPIFY_STORE_DOMAIN || 'shopex2.myshopify.com';
    const storeDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    try {
        const accessToken = await getShopifyAccessToken();

        const response = await axios.get(
            `https://${storeDomain}/admin/api/2024-07/orders.json?name=%23${orderNumberClean}&status=any`,
            {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            }
        );

        let orders = response.data.orders;

        if (!orders || orders.length === 0) {
            const fallbackResponse = await axios.get(
                `https://${storeDomain}/admin/api/2024-07/orders.json?name=${orderNumberClean}&status=any`,
                {
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json'
                    }
                }
            );
            orders = fallbackResponse.data.orders;
        }

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
        console.error('Shopify API Error Status:', error?.response?.status);
        console.error('Shopify API Error Details:', JSON.stringify(error?.response?.data || error.message));
        return "⚠️ Unable to fetch order status right now. Please check credentials or permissions.";
    }
}

// Main WhatsApp Connection Logic
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQr = qr;
            console.log('New QR code generated.');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed (Reason:', lastDisconnect.error?.output?.statusCode, '). Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            currentQr = '';
            console.log('✅ WhatsApp bot is connected and auto-reply is active!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const text = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                ''
            ).trim();

            if (!text) continue;

            console.log(`Message from ${msg.key.remoteJid}: "${text}"`);

            // Check if message is an order number lookup (e.g. 1012, #1012, 1013)
            const orderMatch = text.match(/^#?(\d{4,6})$/);

            if (orderMatch) {
                const orderNumberClean = orderMatch[1];
                await sock.sendMessage(msg.key.remoteJid, {
                    text: `🔍 Checking status for Order #${orderNumberClean}...`
                });

                const statusResult = await getShopifyOrderStatus(orderNumberClean);
                await sock.sendMessage(msg.key.remoteJid, { text: statusResult });
            }
        }
    });
}

// Prevent process crashes from background sync errors
process.on('uncaughtException', (err) => {
    if (err?.message?.includes('failed to sync state') || err?.message?.includes('tried remove')) {
        console.warn('Suppressed Baileys sync background error:', err.message);
    } else {
        console.error('Uncaught Exception:', err);
    }
});

connectToWhatsApp();    if (!clientId || !clientSecret) {
        throw new Error("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET");
    }

    const response = await axios.post(
        `https://${storeDomain}/admin/oauth/access_token`,
        {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        },
        {
            headers: { 'Content-Type': 'application/json' }
        }
    );

    return response.data.access_token;
}

// Function to fetch Shopify Order Status
async function getShopifyOrderStatus(orderNumberClean) {
    const rawDomain = process.env.SHOPIFY_STORE_DOMAIN || 'shopex2.myshopify.com';
    const storeDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    try {
        const accessToken = await getShopifyAccessToken();

        const response = await axios.get(
            `https://${storeDomain}/admin/api/2024-07/orders.json?name=%23${orderNumberClean}&status=any`,
            {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            }
        );

        let orders = response.data.orders;

        if (!orders || orders.length === 0) {
            const fallbackResponse = await axios.get(
                `https://${storeDomain}/admin/api/2024-07/orders.json?name=${orderNumberClean}&status=any`,
                {
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json'
                    }
                }
            );
            orders = fallbackResponse.data.orders;
        }

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
        console.error('Shopify API Error Status:', error?.response?.status);
        console.error('Shopify API Error Details:', JSON.stringify(error?.response?.data || error.message));
        return "⚠️ Unable to fetch order status right now. Please check credentials or permissions.";
    }
}

// Main WhatsApp Connection Logic
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQr = qr;
            console.log('New QR code generated.');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed (Reason:', lastDisconnect.error?.output?.statusCode, '). Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            currentQr = '';
            console.log('✅ WhatsApp bot is connected and auto-reply is active!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const text = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                ''
            ).trim();

            if (!text) continue;

            console.log(`Message from ${msg.key.remoteJid}: "${text}"`);

            // Check if message is an order number lookup (e.g. 1012, #1012, 1013)
            const orderMatch = text.match(/^#?(\d{4,6})$/);

            if (orderMatch) {
                const orderNumberClean = orderMatch[1];
                await sock.sendMessage(msg.key.remoteJid, {
                    text: `🔍 Checking status for Order #${orderNumberClean}...`
                });

                const statusResult = await getShopifyOrderStatus(orderNumberClean);
                await sock.sendMessage(msg.key.remoteJid, { text: statusResult });
            }
        }
    });
}

connectToWhatsApp();
