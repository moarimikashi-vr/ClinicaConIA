import { useCallback, useState } from 'react';

// Boolean UI preference saved in localStorage (e.g. a side panel shown or hidden).
// Storage may be unavailable (private mode, blocked site data): the toggle still works for the session.
export const usePersistentToggle = (key, defaultValue = true) => {
    const [value, setValue] = useState(() => {
        try {
            const stored = localStorage.getItem(key);
            return stored === null ? defaultValue : stored === 'true';
        } catch {
            return defaultValue;
        }
    });

    const toggle = useCallback(() => {
        setValue((v) => {
            try {
                localStorage.setItem(key, String(!v));
            } catch {
                // Preference lasts only for this session
            }
            return !v;
        });
    }, [key]);

    return [value, toggle];
};
