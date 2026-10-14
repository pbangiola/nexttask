'use strict';
// Structured occurrences stay attached to their estimates through review/sorting.
// Commas in plain names remain names; explicit duration tokens enable compact pairs.
window.TaskEntry = {
    parse(text) {
        const entries = [], invalid = [];
        const durationToken = value => /^[+-]?\d+(?:\.\d+)?\s*(?:m|min|mins|minutes?|h|hr|hrs|hours?)$/i.test(value) || parseDurationMs(value) !== null;
        for (const original of String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
            const line = original.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, '').trim();
            const tokens = line.split(',').map(s => s.trim());
            const records = [];
            if (tokens.length > 1 && tokens.some((s, i) => durationToken(s) || (i > 0 && /^\d+(?:\.\d+)?$/.test(s)))) {
                for (let i = 0; i < tokens.length; i++) {
                    if (!tokens[i] || durationToken(tokens[i])) { invalid.push(original); break; }
                    const duration = i + 1 < tokens.length ? parseDurationMs(tokens[i + 1], true) : null;
                    records.push({ name: tokens[i], estimatedTimeMs: duration || 0 });
                    if (duration) i++;
                }
            } else {
                const parsed = parseTimedTaskChunk(line);
                if (durationToken(line) || /(?:,\s*|\s+)[+-]?\d+(?:\.\d+)?\s*(?:m|min|mins|minutes?|h|hours?)\s*$/i.test(line) && !parsed) invalid.push(original);
                else records.push(parsed || { name: line, estimatedTimeMs: 0 });
            }
            if (!invalid.includes(original)) entries.push(...records.filter(r => r.name));
        }
        return { entries, invalid };
    }
};
