import { put, list, del, head } from '@vercel/blob';
import { proto } from '@whiskeysockets/baileys';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import type { AuthenticationState, SignalDataTypeMap, SignalDataSet } from '@whiskeysockets/baileys';

const PREFIX = 'whatsapp-auth/';

async function blobExists(path: string): Promise<boolean> {
    try {
        await head(path);
        return true;
    } catch {
        return false;
    }
}

async function readBlob(path: string): Promise<string | null> {
    try {
        const metadata = await head(path);
        const response = await fetch(metadata.url);
        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    }
}

async function writeBlob(path: string, data: string): Promise<void> {
    await put(path, data, { access: 'public', addRandomSuffix: false });
}

async function deleteBlob(path: string): Promise<void> {
    try {
        const metadata = await head(path);
        await del(metadata.url);
    } catch {
        // ignore if not found
    }
}

export async function clearVercelBlobAuthState(): Promise<void> {
    const { blobs } = await list({ prefix: PREFIX });
    if (blobs.length > 0) {
        await del(blobs.map((b) => b.url));
    }
}

export async function useVercelBlobAuthState(): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
}> {
    const credsPath = `${PREFIX}creds.json`;

    const credsRaw = await readBlob(credsPath);
    const creds = credsRaw
        ? JSON.parse(credsRaw, BufferJSON.reviver)
        : initAuthCreds();

    const keys = {
        async get<T extends keyof SignalDataTypeMap>(
            type: T,
            ids: string[]
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
            const result: { [id: string]: SignalDataTypeMap[T] } = {};
            for (const id of ids) {
                const raw = await readBlob(`${PREFIX}${type}-${id}.json`);
                if (raw) {
                    let parsed = JSON.parse(raw, BufferJSON.reviver);
                    if (type === 'app-state-sync-key') {
                        parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
                    }
                    result[id] = parsed;
                }
            }
            return result;
        },

        async set(data: SignalDataSet): Promise<void> {
            for (const type in data) {
                const entries = data[type as keyof SignalDataTypeMap]!;
                for (const id in entries) {
                    const value = entries[id];
                    const path = `${PREFIX}${type}-${id}.json`;
                    if (value) {
                        await writeBlob(
                            path,
                            JSON.stringify(value, BufferJSON.replacer)
                        );
                    } else {
                        await deleteBlob(path);
                    }
                }
            }
        },
    };

    const saveCreds = async () => {
        await writeBlob(credsPath, JSON.stringify(creds, BufferJSON.replacer));
    };

    return { state: { creds, keys }, saveCreds };
}
