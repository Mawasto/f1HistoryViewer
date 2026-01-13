export type RecentSearch = {
    type: 'main' | 'season-results' | 'driver-stats' | 'constructor-stats' | 'track-stats' | 'pitstops' | 'compare-drivers' | 'season-calendar'
    label: string
    path: string
    timestamp: number
}

const RECENT_SEARCHES_KEY = 'recent_searches_v1'
const MAX_RECENT = 5

export function getRecentSearches(): RecentSearch[] {
    try {
        const cached = sessionStorage.getItem(RECENT_SEARCHES_KEY)
        if (!cached) return []
        const parsed = JSON.parse(cached)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

export function addRecentSearch(search: Omit<RecentSearch, 'timestamp'>): void {
    const current = getRecentSearches()
    const newEntry: RecentSearch = { ...search, timestamp: Date.now() }

    // Remove duplicate if exists (same type + label)
    const filtered = current.filter(
        (s) => !(s.type === search.type && s.label === search.label)
    )

    // Add new entry at the beginning
    const updated = [newEntry, ...filtered].slice(0, MAX_RECENT)

    try {
        sessionStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
    } catch {
        // ignore storage errors
    }
}

export function clearRecentSearches(): void {
    try {
        sessionStorage.removeItem(RECENT_SEARCHES_KEY)
    } catch {
        // ignore
    }
}