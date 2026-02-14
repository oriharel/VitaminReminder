import { google } from 'googleapis';

export function getCalendarClient() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) {
        throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable');
    }

    const key = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    return google.calendar({ version: 'v3', auth });
}

export async function getTomorrowEvents() {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) {
        throw new Error('Missing GOOGLE_CALENDAR_ID environment variable');
    }

    const calendar = getCalendarClient();

    // Calculate tomorrow's date range in Israel time (Asia/Jerusalem)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const israelDate = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
    const timeMin = new Date(`${israelDate}T00:00:00+02:00`).toISOString();
    const timeMax = new Date(`${israelDate}T23:59:59+02:00`).toISOString();

    const response = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
    });

    return {
        events: response.data.items || [],
        date: israelDate,
    };
}

export function formatCalendarMessage(events: any[], date: string): string {
    const dateObj = new Date(date + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });

    if (events.length === 0) {
        return `📅 Tomorrow's Schedule (${formattedDate}):\n\nNo events scheduled. Enjoy your free day!`;
    }

    const lines = events.map((event) => {
        const summary = event.summary || '(No title)';

        // All-day events have a `date` field instead of `dateTime`
        if (event.start?.date) {
            return `🗓️ ${summary} (All day)`;
        }

        const startTime = new Date(event.start.dateTime);
        const time = startTime.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jerusalem',
        });
        return `${time} - ${summary}`;
    });

    return [
        `📅 Tomorrow's Schedule (${formattedDate}):`,
        '',
        ...lines,
        '',
        `Total: ${events.length} event${events.length === 1 ? '' : 's'}`,
    ].join('\n');
}
