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
    const calendarIds = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarIds) {
        throw new Error('Missing GOOGLE_CALENDAR_ID environment variable');
    }

    const calendar = getCalendarClient();
    const ids = calendarIds.split(',').map((id) => id.trim()).filter(Boolean);

    // Calculate tomorrow's date range in Israel time (Asia/Jerusalem)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const israelDate = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
    const timeMin = new Date(`${israelDate}T00:00:00+02:00`).toISOString();
    const timeMax = new Date(`${israelDate}T23:59:59+02:00`).toISOString();

    // Fetch events from all calendars in parallel, tolerating individual failures
    const results = await Promise.allSettled(
        ids.map((calendarId) =>
            calendar.events.list({
                calendarId,
                timeMin,
                timeMax,
                singleEvents: true,
                orderBy: 'startTime',
            })
        )
    );

    // Merge and deduplicate events by ID, then sort by start time
    const seenIds = new Set<string>();
    const allEvents: any[] = [];
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
            console.error(`Failed to fetch calendar ${ids[i]}:`, result.reason?.message || result.reason);
            continue;
        }
        for (const event of result.value.data.items || []) {
            const eventId = event.id || event.summary + event.start?.dateTime;
            if (!seenIds.has(eventId)) {
                seenIds.add(eventId);
                allEvents.push(event);
            }
        }
    }

    allEvents.sort((a, b) => {
        const aTime = a.start?.dateTime || a.start?.date || '';
        const bTime = b.start?.dateTime || b.start?.date || '';
        return aTime.localeCompare(bTime);
    });

    return {
        events: allEvents,
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
