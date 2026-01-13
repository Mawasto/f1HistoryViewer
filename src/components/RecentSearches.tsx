import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getRecentSearches } from '../utils/recentSearches'
import type { RecentSearch } from '../utils/recentSearches'
import '../styles/RecentSearches.css'

const typeIcons: Record<RecentSearch['type'], string> = {
    'main': '🏠',
    'season-results': '📊',
    'driver-stats': '🏎️',
    'constructor-stats': '🏭',
    'track-stats': '🛣️',
    'pitstops': '⏱️',
    'compare-drivers': '⚔️',
    'season-calendar': '📅',
}

const RecentSearches = () => {
    const [searches, setSearches] = useState<RecentSearch[]>([])

    useEffect(() => {
        const update = () => setSearches(getRecentSearches())
        update()

        // Listen for storage events to update in real-time
        const handler = () => update()
        window.addEventListener('storage', handler)
        
        // Poll for updates (since sessionStorage doesn't trigger events in same tab)
        const interval = setInterval(update, 1000)

        return () => {
            window.removeEventListener('storage', handler)
            clearInterval(interval)
        }
    }, [])

    if (searches.length === 0) return null

    return (
        <div className="recent-searches">
            <p className="recent-searches-title">Recent activity</p>
            <ul className="recent-searches-list">
                {searches.map((s, i) => (
                    <li key={`${s.type}-${s.timestamp}-${i}`}>
                        <Link to={s.path} className="recent-search-link">
                            <span className="recent-search-icon">{typeIcons[s.type]}</span>
                            <span className="recent-search-label">{s.label}</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    )
}

export default RecentSearches