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

async function main() {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('Error: BLOB_READ_WRITE_TOKEN environment variable is required.');
        console.error('Get it from: Vercel Dashboard > Storage > Blob > Tokens');
        process.exit(1);
    }

    console.log('Loading auth state from Vercel Blob...');
    const { state, saveCreds, flushToBlob } = await useVercelBlobAuthState();

    console.log(`Creds registered: ${state.creds.registered}, me: ${JSON.stringify(state.creds.me)}`);

    const { version } = await fetchLatestBaileysVersion();
    console.log(`Using WA Web version: ${version.join('.')}`);

    let retries = 0;
    const MAX_RETRIES = 5;

    function connect(): Promise<void> {
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
        });

        sock.ev.on('creds.update', saveCreds);

        return new Promise((resolve, reject) => {
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log('\nScan this QR code with WhatsApp:\n');
                    qrcode.generate(qr, { small: true });
                    console.log('\nOpen WhatsApp > Settings > Linked Devices > Link a Device\n');
                }

                if (connection === 'open') {
                    retries = 0;
                    console.log('\nConnected successfully!');
                    console.log(`Logged in as: ${sock.user?.name || sock.user?.id}`);

                    // Flush all auth data to Blob now that we're connected
                    console.log('Persisting auth state to Vercel Blob...');
                    await flushToBlob();
                    console.log('Auth state persisted.');

                    console.log('\nWaiting for group data to sync...');
                    await new Promise((r) => setTimeout(r, 5000));

                    try {
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
                    } catch (err) {
                        console.error('Failed to fetch groups:', err);
                    }

                    // Final flush to capture any additional cred updates
                    await flushToBlob();
                    console.log('\nAuth credentials saved to Vercel Blob. You can close this script.');
                    sock.end(undefined);
                    resolve();
                }

                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;

                    // Always flush before reconnecting so no keys are lost
                    console.log('Flushing auth state before reconnect...');
                    await flushToBlob();

                    sock.end(undefined);

                    if (statusCode === DisconnectReason.loggedOut) {
                        console.error('\nLogged out. Clearing stale auth and starting fresh...');
                        await clearVercelBlobAuthState();
                        console.log('Please restart the script to get a new QR code.');
                        process.exit(1);
                    }

                    retries++;
                    if (retries > MAX_RETRIES) {
                        console.error(`\nFailed after ${MAX_RETRIES} reconnect attempts.`);
                        process.exit(1);
                    }

                    console.log(`\nReconnecting (attempt ${retries}/${MAX_RETRIES}, code: ${statusCode})...`);
                    await new Promise((r) => setTimeout(r, 3000));
                    resolve(connect());
                }
            });
        });
    }

    await connect();
    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
