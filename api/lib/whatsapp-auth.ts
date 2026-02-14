import { put, list, del, head } from '@vercel/blob';
import { proto } from '@whiskeysockets/baileys';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import type { AuthenticationState, SignalDataTypeMap, SignalDataSet } from '@whiskeysockets/baileys';

const PREFIX = 'whatsapp-auth/';

// ---------------------------------------------------------------------------
// Low-level Vercel Blob helpers
// ---------------------------------------------------------------------------

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
    await put(path, data, { access: 'public', addRandomSuffix: false, allowOverwrite: true });
}

async function deleteBlob(path: string): Promise<void> {
    try {
        const metadata = await head(path);
        await del(metadata.url);
    } catch {
        // ignore if not found
    }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export async function clearVercelBlobAuthState(): Promise<void> {
    const { blobs } = await list({ prefix: PREFIX });
    if (blobs.length > 0) {
        await del(blobs.map((b) => b.url));
    }
}

// ---------------------------------------------------------------------------
// Auth state backed by in-memory cache + Vercel Blob persistence
//
// Reads/writes during a session hit memory so Baileys never waits on HTTP.
// `flushToBlob()` persists the dirty entries and should be awaited before the
// process exits or before reconnecting.
// ---------------------------------------------------------------------------

export async function useVercelBlobAuthState(): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
    flushToBlob: () => Promise<void>;
}> {
    const credsPath = `${PREFIX}creds.json`;

    // --- Load creds from Blob (one-time) ---
    const credsRaw = await readBlob(credsPath);
    const creds = credsRaw
        ? JSON.parse(credsRaw, BufferJSON.reviver)
        : initAuthCreds();

    // --- In-memory key cache ---
    const keyCache = new Map<string, any>();   // path -> parsed value (or null for deleted)
    const dirtyKeys = new Set<string>();        // paths that need flushing
    let credsDirty = false;

    // Pre-load all existing keys from Blob into cache
    const { blobs } = await list({ prefix: PREFIX });
    const loadPromises = blobs
        .filter((b) => b.pathname !== credsPath)
        .map(async (b) => {
            try {
                const response = await fetch(b.url);
                if (response.ok) {
                    const text = await response.text();
                    keyCache.set(b.pathname, JSON.parse(text, BufferJSON.reviver));
                }
            } catch {
                // skip unreadable blobs
            }
        });
    await Promise.all(loadPromises);

    // --- Flush dirty entries to Blob ---
    async function flushToBlob(): Promise<void> {
        const promises: Promise<void>[] = [];

        if (credsDirty) {
            promises.push(writeBlob(credsPath, JSON.stringify(creds, BufferJSON.replacer)));
            credsDirty = false;
        }

        for (const path of dirtyKeys) {
            const value = keyCache.get(path);
            if (value === null || value === undefined) {
                promises.push(deleteBlob(path));
            } else {
                promises.push(writeBlob(path, JSON.stringify(value, BufferJSON.replacer)));
            }
        }
        dirtyKeys.clear();

        await Promise.all(promises);
    }

    // --- Baileys key store (reads/writes are in-memory only) ---
    const keys = {
        async get<T extends keyof SignalDataTypeMap>(
            type: T,
            ids: string[]
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
            const result: { [id: string]: SignalDataTypeMap[T] } = {};
            for (const id of ids) {
                const path = `${PREFIX}${type}-${id}.json`;
                const cached = keyCache.get(path);
                if (cached != null) {
                    let value = cached;
                    if (type === 'app-state-sync-key') {
                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    result[id] = value;
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
                        keyCache.set(path, value);
                    } else {
                        keyCache.set(path, null);
                    }
                    dirtyKeys.add(path);
                }
            }
        },
    };

    const saveCreds = async () => {
        credsDirty = true;
    };

    return { state: { creds, keys }, saveCreds, flushToBlob };
}
