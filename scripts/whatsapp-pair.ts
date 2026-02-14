/**
 * One-time WhatsApp pairing script.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_xxx npx tsx scripts/whatsapp-pair.ts
 *
 * This script:
 * 1. Shows a QR code in the terminal for scanning with WhatsApp
 * 2. Saves auth credentials to Vercel Blob Storage
 * 3. Lists all groups and their JIDs so you can find the target group
 */

import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { useVercelBlobAuthState, clearVercelBlobAuthState } from '../api/lib/whatsapp-auth.js';
import qrcode from 'qrcode-terminal';

async function startSocket(): Promise<void> {
    console.log('Loading auth state from Vercel Blob...');
    const { state, saveCreds } = await useVercelBlobAuthState();

    console.log(`Creds registered: ${state.creds.registered}, me: ${JSON.stringify(state.creds.me)}`);

    const { version } = await fetchLatestBaileysVersion();
    console.log(`Using WA Web version: ${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
    });

    // Queue all cred saves so none are lost
    let saveQueue = Promise.resolve();
    sock.ev.on('creds.update', () => {
        saveQueue = saveQueue.then(() => saveCreds());
    });

    return new Promise((resolve, reject) => {
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('\nScan this QR code with WhatsApp:\n');
                qrcode.generate(qr, { small: true });
                console.log('\nOpen WhatsApp > Settings > Linked Devices > Link a Device\n');
            }

            if (connection === 'open') {
                console.log('\nConnected successfully!');
                console.log(`Logged in as: ${sock.user?.name || sock.user?.id}`);

                console.log('\nWaiting for group data to sync...');
                await new Promise((r) => setTimeout(r, 5000));

                const groups = await sock.groupFetchAllParticipating();
                const groupList = Object.values(groups);

                if (groupList.length > 0) {
                    console.log(`\n=== Your WhatsApp Groups (${groupList.length}) ===\n`);
                    for (const group of groupList) {
                        console.log(`  Name: ${group.subject}`);
                        console.log(`  JID:  ${group.id}`);
                        console.log(`  Size: ${group.participants.length} members`);
                        console.log('');
                    }
                    console.log('Set WHATSAPP_GROUP_JID in Vercel to the JID of the target group.');
                } else {
                    console.log('\nNo groups found. Make sure you are a member of at least one group.');
                }

                console.log('\nAuth credentials saved to Vercel Blob. You can close this script.');
                sock.end(undefined);
                resolve();
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut) {
                    console.error('\nLogged out. Clearing stale auth and starting fresh...');
                    sock.end(undefined);
                    await clearVercelBlobAuthState();
                    resolve(startSocket());
                } else {
                    // Force save current creds state and wait for all queued saves
                    console.log('Flushing credential saves...');
                    saveQueue = saveQueue.then(() => saveCreds());
                    await saveQueue;
                    console.log(`Creds after save - registered: ${state.creds.registered}, me: ${JSON.stringify(state.creds.me)}`);

                    sock.end(undefined);

                    console.log(`\nReconnecting (code: ${statusCode})...`);
                    await new Promise((r) => setTimeout(r, 3000));
                    resolve(startSocket());
                }
            }
        });
    });
}

async function main() {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('Error: BLOB_READ_WRITE_TOKEN environment variable is required.');
        console.error('Get it from: Vercel Dashboard > Storage > Blob > Tokens');
        process.exit(1);
    }

    await startSocket();
    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
