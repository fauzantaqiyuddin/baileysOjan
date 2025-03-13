const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('Scan QR Code:');
            console.log(await qrcode.toString(qr, { type: 'terminal', small: true }));
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                startSock();
            } else {
                console.log('Logged out, please scan QR code again.');
            }
        } else if (connection === 'open') {
            console.log('Connected to WhatsApp');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.message || !msg.key.remoteJid) return;
            const sender = msg.key.remoteJid;
            const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

            if (textMessage === '!pingServer') {
                console.log(`Received !pingServer from ${sender}`);
                await sock.sendPresenceUpdate('composing', sender);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate typing for 5 seconds
                await sock.sendMessage(sender, { text: 'Server is running ✅' });
            }
        }
    });

    app.post('/send-message', async (req, res) => {
        const { number, message } = req.body;
        if (!number || !message) {
            return res.status(400).json({ error: 'Number and message are required' });
        }

        try {
            const formattedNumber = number.includes('@s.whatsapp.net') ? number : number + '@s.whatsapp.net';
            await sock.sendMessage(formattedNumber, { text: message }).catch(err => {
                throw new Error(`Failed to send message: ${err.message}`);
            });
            res.json({ success: true, message: 'Message sent successfully' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
};

startSock();

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});