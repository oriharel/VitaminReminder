import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';
import { getTomorrowEvents, formatCalendarMessage } from './lib/calendar.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_CALENDAR_ID } = process.env;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !GOOGLE_SERVICE_ACCOUNT_KEY || !GOOGLE_CALENDAR_ID) {
        return res.status(500).json({ error: 'Missing environment variables' });
    }

    try {
        const { events, date } = await getTomorrowEvents();
        const message = formatCalendarMessage(events, date);

        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Telegram API error:', data);
            return res.status(500).json({ error: 'Failed to send notification', details: data });
        }

        return res.status(200).json({ success: true, data });
    } catch (error) {
        const err = error as Error;
        console.error('Calendar summary error:', err);
        return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
}
