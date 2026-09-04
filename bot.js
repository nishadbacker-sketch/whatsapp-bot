const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

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
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Connection closed (Reason: ${statusCode}). Reconnecting: ${shouldReconnect}`);

            if (shouldReconnect) {
                setTimeout(() => {
                    connectToWhatsApp();
                }, 3000);
            } else {
                console.log('Logged out. Delete auth_info_baileys folder and rescan QR code.');
            }
        } else if (connection === 'open') {
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

            // --- Auto-Reply Logic ---
            if (['hi', 'hello', 'hey', 'menu', 'start'].includes(text)) {
                const welcomeMenu = 
                    `👋 *Welcome to Shopex Customer Support!*\n\n` +
                    `Reply with a number to choose an option:\n` +
                    `1️⃣ View Store Catalog\n` +
                    `2️⃣ Check Order Status\n` +
                    `3️⃣ Store Hours & Details\n` +
                    `4️⃣ Talk to Support`;

                await sock.sendMessage(senderJid, { text: welcomeMenu });
            } 
            else if (text === '1') {
                await sock.sendMessage(senderJid, { 
                    text: `🛍️ Explore our catalog at https://shopexme.com` 
                });
            } 
            else if (text === '2') {
                await sock.sendMessage(senderJid, { 
                    text: `📦 Please reply with your Order ID (e.g., #1042) to check status.` 
                });
            } 
            else if (text === '3') {
                await sock.sendMessage(senderJid, { 
                    text: `🕒 *Hours:* Mon - Sat, 9:00 AM - 7:00 PM IST\n📍 *Store:* https://shopexme.com` 
                });
            } 
            else if (text === '4') {
                await sock.sendMessage(senderJid, { 
                    text: `🧑‍💼 A support team member will respond shortly!` 
                });
            } 
            else {
                await sock.sendMessage(senderJid, { 
                    text: `Type *hi* or *menu* to see available options.` 
                });
            }
        }
    });
}

connectToWhatsApp();
