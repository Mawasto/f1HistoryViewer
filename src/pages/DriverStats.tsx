import { useEffect, useMemo, useState } from 'react'

type Driver = {
    driverId: string
    givenName: string
    familyName: string
    permanentNumber?: string
    code?: string
    nationality?: string
}

const DRIVER_CACHE_KEY = 'allDrivers_cache_v1'

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

async function fetchDriversRateLimited(): Promise<Driver[]> {
    // try cache first
    const cached = sessionStorage.getItem(DRIVER_CACHE_KEY)
    if (cached) {
        try {
            const parsed = JSON.parse(cached)
            if (Array.isArray(parsed)) return parsed
        } catch {
            // ignore broken cache
        }
    }

    const limit = 100
    let offset = 0
    let total = Infinity
    const all: Driver[] = []

    while (offset === 0 || offset < total) {
        let attempt = 0
        while (attempt < 4) {
            const url = `https://api.jolpi.ca/ergast/f1/drivers/?limit=${limit}&offset=${offset}`
            const res = await fetch(url)
            if (res.status === 429) {
                // back off on throttling
                await sleep(500 * (attempt + 1))
                attempt++
                continue
            }
            if (!res.ok) {
                throw new Error(`Failed to fetch drivers at offset ${offset}`)
            }

            const data = await res.json()
            const mr = data?.MRData
            total = parseInt(mr?.total ?? '0', 10) || 0
            const drivers: Driver[] = mr?.DriverTable?.Drivers ?? []
            all.push(...drivers)
            break
        }

        offset += limit
        // gentle pacing to stay under burst rate
        await sleep(300)
    }

    try { sessionStorage.setItem(DRIVER_CACHE_KEY, JSON.stringify(all)) } catch {}
    return all
}

const DriverStats = () => {
    const [drivers, setDrivers] = useState<Driver[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [selectedName, setSelectedName] = useState('')

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoading(true)
            setError('')
            try {
                const list = await fetchDriversRateLimited()
                const sorted = list.slice().sort((a, b) => {
                    const nameA = `${a.givenName} ${a.familyName}`.toLowerCase()
                    const nameB = `${b.givenName} ${b.familyName}`.toLowerCase()
                    return nameA.localeCompare(nameB)
                })
                if (!cancelled) setDrivers(sorted)
            } catch (err) {
                if (!cancelled) setError('Failed to load drivers. Please retry in a moment.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [])

    const selectedDriver = useMemo(() => {
        const target = selectedName.trim().toLowerCase()
        if (!target) return undefined
        return drivers.find((d) => `${d.givenName} ${d.familyName}`.toLowerCase() === target)
    }, [drivers, selectedName])

    return (
        <div>
            <h2>Driver Stats</h2>
            {loading && <p>Loading driver list…</p>}
            {error && <p style={{ color: 'red' }}>{error}</p>}

            <div style={{ marginTop: '1rem' }}>
                <label htmlFor="driver-input" style={{ fontWeight: 600 }}>
                    Select a driver:
                </label>
                <input
                    id="driver-input"
                    list="driver-options"
                    value={selectedName}
                    onChange={(e) => setSelectedName(e.target.value)}
                    placeholder="Start typing a driver name"
                    style={{ marginLeft: '0.5rem', minWidth: '260px', padding: '6px' }}
                />
                <datalist id="driver-options">
                    {drivers.map((d) => {
                        const fullName = `${d.givenName} ${d.familyName}`
                        return (
                            <option key={d.driverId} value={fullName}>{fullName}</option>
                        )
                    })}
                </datalist>
            </div>

            {selectedDriver && (
                <div style={{ marginTop: '1rem', textAlign: 'left' }}>
                    <h3>{selectedDriver.givenName} {selectedDriver.familyName}</h3>
                    <p><strong>Driver ID:</strong> {selectedDriver.driverId}</p>
                    {selectedDriver.permanentNumber && <p><strong>Number:</strong> {selectedDriver.permanentNumber}</p>}
                    {selectedDriver.code && <p><strong>Code:</strong> {selectedDriver.code}</p>}
                    {selectedDriver.nationality && <p><strong>Nationality:</strong> {selectedDriver.nationality}</p>}
                </div>
            )}
        </div>
    )
}

export default DriverStats
