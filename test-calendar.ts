import fetch from 'node-fetch';
import { getTomorrowEvents, formatCalendarMessage } from './api/lib/calendar.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

if (!GOOGLE_SERVICE_ACCOUNT_KEY || !GOOGLE_CALENDAR_ID) {
    console.error("❌ Error: Please set GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_CALENDAR_ID environment variables.");
    process.exit(1);
}

async function testCalendarSummary() {
    console.log('Fetching tomorrow\'s events...\n');

    const { events, date } = await getTomorrowEvents();
    const message = formatCalendarMessage(events, date);

    console.log('--- Formatted Message ---');
    console.log(message);
    console.log('-------------------------\n');

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        console.log(`Sending to Telegram chat ${TELEGRAM_CHAT_ID}...`);
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('❌ Telegram API error:', data);
        } else {
            console.log('✅ Notification sent successfully!');
        }
    } else {
        console.log('ℹ️  Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to also send to Telegram.');
    }
}

testCalendarSummary().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
