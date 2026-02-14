import type { VercelRequest, VercelResponse } from '@vercel/node';
import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useVercelBlobAuthState } from './lib/whatsapp-auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { WHATSAPP_GROUP_JID } = process.env;

    if (!WHATSAPP_GROUP_JID) {
        return res.status(500).json({ error: 'Missing WHATSAPP_GROUP_JID environment variable' });
    }

    const message =
        (typeof req.query.message === 'string' ? req.query.message : null) ||
        (typeof req.body === 'object' && req.body?.message ? req.body.message : null) ||
        null;

    if (!message) {
        return res.status(400).json({ error: 'Message is required (query param or POST body)' });
    }

    let sock: ReturnType<typeof makeWASocket> | null = null;

    try {
        const { state, saveCreds, flushToBlob } = await useVercelBlobAuthState();

        if (!state.creds.registered) {
            return res.status(500).json({
                error: 'WhatsApp not authenticated. Run the pairing script first: tsx scripts/whatsapp-pair.ts',
            });
        }

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
        });

        sock.ev.on('creds.update', saveCreds);

        // Wait for connection to be ready
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30_000);

            sock!.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'open') {
                    clearTimeout(timeout);
                    resolve();
                } else if (connection === 'close') {
                    clearTimeout(timeout);
                    const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut) {
                        reject(new Error('WhatsApp logged out. Re-run the pairing script.'));
                    } else {
                        reject(new Error(`Connection closed: ${lastDisconnect?.error?.message || 'unknown'}`));
                    }
                }
            });
        });

        await sock.sendMessage(WHATSAPP_GROUP_JID, { text: message });

        // Persist any credential updates before disconnecting
        await flushToBlob();

        sock.end(undefined);
        sock = null;

        return res.status(200).json({ success: true, message: 'WhatsApp message sent' });
    } catch (error) {
        const err = error as Error;
        console.error('WhatsApp error:', err);
        if (sock) {
            try { sock.end(undefined); } catch { /* ignore */ }
        }
        return res.status(500).json({ error: 'Failed to send WhatsApp message', details: err.message });
    }
}
