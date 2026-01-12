import { useEffect, useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
	Chart as ChartJS,
	CategoryScale,
	LinearScale,
	BarElement,
	Title,
	Tooltip,
	Legend,
} from 'chart.js'
import '../styles/MainPage.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const MIN_YEAR = 2011
const MAX_YEAR = 2025
const PITSTOP_PAGE_LIMIT = 100
const REQUEST_SPACING_MS = 700
const MAX_RETRIES = 6
const BASE_RETRY_DELAY_MS = 800

type PitStopStat = {
	season: string
	round: string
	raceName: string
	driverId: string
	lap: string
	stop: string
	durationStr: string
	durationSeconds: number
}

type DriverStopRank = {
	driverId: string
	stops: number
	avgSeconds: number
}

const STOPS_COLOR = 'rgba(239, 68, 68, 0.8)'
const AVG_COLOR = 'rgba(59, 130, 246, 0.8)'

type DriverNameMap = Record<string, string>

const clampYear = (year: number) => Math.min(MAX_YEAR, Math.max(MIN_YEAR, year))

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

const fetchJsonWithBackoff = async (url: string, retries = MAX_RETRIES, baseDelay = BASE_RETRY_DELAY_MS): Promise<any> => {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetch(url)
			if (res.status === 429 || res.status >= 500) {
				if (attempt === retries) throw new Error(`Throttled or server error for ${url}`)
				await sleep(baseDelay * (attempt + 1))
				continue
			}
			if (!res.ok) throw new Error(`Request failed ${res.status} for ${url}`)
			const json = await res.json()
			await sleep(REQUEST_SPACING_MS) // throttle requests to reduce 429s
			return json
		} catch (err) {
			if (attempt === retries) throw err
			await sleep(baseDelay * (attempt + 1))
		}
	}
	throw new Error(`Failed to fetch ${url}`)
}

const durationToSeconds = (duration: string | undefined): number | null => {
	if (!duration) return null
	const trimmed = duration.trim()
	if (!trimmed) return null
	if (trimmed.includes(':')) {
		const parts = trimmed.split(':').map(Number)
		if (parts.some(n => Number.isNaN(n))) return null
		if (parts.length === 2) {
			const [mins, secs] = parts
			return mins * 60 + secs
		}
	}
	const asFloat = parseFloat(trimmed)
	return Number.isFinite(asFloat) ? asFloat : null
}

const Pitstops = () => {
	const years = useMemo(() => Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i), [])
	const [fromYear, setFromYear] = useState<number>(MIN_YEAR)
	const [toYear, setToYear] = useState<number>(MAX_YEAR)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [fastest, setFastest] = useState<PitStopStat | null>(null)
	const [slowest, setSlowest] = useState<PitStopStat | null>(null)
	const [totalStops, setTotalStops] = useState(0)
	const [totalRaces, setTotalRaces] = useState(0)
	const [progress, setProgress] = useState<string>('')
	const [driverRanking, setDriverRanking] = useState<DriverStopRank[]>([])
	const [driverNames, setDriverNames] = useState<DriverNameMap>({})

	const driverStopsChart = useMemo(() => {
		if (!driverRanking.length) return null

		const labels = driverRanking.map((row) => driverNames[row.driverId] ?? row.driverId)
		const stopsData = driverRanking.map((row) => row.stops)
		const avgData = driverRanking.map((row) => Number(row.avgSeconds.toFixed(3)))

		return {
			data: {
				labels,
				datasets: [
					{
						label: 'Pit stops',
						data: stopsData,
						backgroundColor: STOPS_COLOR,
						yAxisID: 'yStops',
						borderColor: 'rgba(239, 68, 68, 1)',
						borderWidth: 1,
					},
					{
						label: 'Avg time (s)',
						data: avgData,
						backgroundColor: AVG_COLOR,
						yAxisID: 'yAvg',
						borderColor: 'rgba(59, 130, 246, 1)',
						borderWidth: 1,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { position: 'bottom' as const },
					title: { display: true, text: 'Driver pit stop counts (most → least)' },
				},
				scales: {
					yStops: {
						type: 'linear' as const,
						position: 'left' as const,
						beginAtZero: true,
						title: { display: true, text: 'Stops' },
					},
					yAvg: {
						type: 'linear' as const,
						position: 'right' as const,
						beginAtZero: true,
						title: { display: true, text: 'Avg time (s)' },
						grid: { drawOnChartArea: false },
					},
					x: { grid: { display: false } },
				},
			},
		}
	}, [driverRanking, driverNames])

	const getCachedStops = (season: string | number, round: string | number): any[] | null => {
		const key = `pitstops_${season}_${round}`
		try {
			const cached = sessionStorage.getItem(key)
			if (!cached) return null
			const parsed = JSON.parse(cached)
			return Array.isArray(parsed) ? parsed : null
		} catch {
			return null
		}
	}

	const cacheStops = (season: string | number, round: string | number, stops: any[]) => {
		const key = `pitstops_${season}_${round}`
		try { sessionStorage.setItem(key, JSON.stringify(stops)) } catch {}
	}

	const getCachedDriverNames = (): DriverNameMap | null => {
		try {
			const cached = sessionStorage.getItem('pitstop_driver_names_v1')
			if (!cached) return null
			const parsed = JSON.parse(cached)
			return parsed && typeof parsed === 'object' ? parsed as DriverNameMap : null
		} catch {
			return null
		}
	}

	const cacheDriverNames = (map: DriverNameMap) => {
		try { sessionStorage.setItem('pitstop_driver_names_v1', JSON.stringify(map)) } catch {}
	}

	const handleFromChange = (value: number) => {
		const nextFrom = clampYear(value)
		const nextTo = Math.max(nextFrom, clampYear(toYear))
		setFromYear(nextFrom)
		setToYear(nextTo)
	}

	const handleToChange = (value: number) => {
		const nextTo = clampYear(value)
		const nextFrom = Math.min(clampYear(fromYear), nextTo)
		setFromYear(nextFrom)
		setToYear(nextTo)
	}

	useEffect(() => {
		let cancelled = false

		const loadDriverNames = async () => {
			if (Object.keys(driverNames).length > 0) return driverNames
			const cached = getCachedDriverNames()
			if (cached) {
				setDriverNames(cached)
				return cached
			}

			const map: DriverNameMap = {}
			let offset = 0
			let total = Infinity
			const limit = 100
			while (offset === 0 || offset < total) {
				const url = `https://api.jolpi.ca/ergast/f1/drivers.json?limit=${limit}&offset=${offset}`
				const data = await fetchJsonWithBackoff(url)
				const mr = data?.MRData
				total = parseInt(mr?.total ?? '0', 10) || 0
				const drivers = mr?.DriverTable?.Drivers ?? []
				drivers.forEach((d: any) => {
					const id = d?.driverId
					const name = [d?.givenName, d?.familyName].filter(Boolean).join(' ').trim()
					if (id && name) map[id] = name
				})
				if (total === 0) break
				offset += limit
			}
			setDriverNames(map)
			cacheDriverNames(map)
			return map
		}

		const loadPitstopStats = async () => {
			setLoading(true)
			setError('')
			setFastest(null)
			setSlowest(null)
			setTotalStops(0)
			setTotalRaces(0)
			setProgress('')
			setDriverRanking([])

			try {
				const nameMap = await loadDriverNames()
				let fastestLocal: PitStopStat | null = null
				let slowestLocal: PitStopStat | null = null
				let stopsCount = 0
				let racesWithStops = 0
				const stopsByDriver: Record<string, number> = {}
				const durationByDriver: Record<string, number> = {}

				for (let season = fromYear; season <= toYear; season++) {
					if (cancelled) return
					setProgress(`Fetching races for ${season}...`)
					const racesData = await fetchJsonWithBackoff(`https://api.jolpi.ca/ergast/f1/${season}.json`)
					const races = racesData?.MRData?.RaceTable?.Races ?? []

					for (const race of races) {
						if (cancelled) return
						const round = race?.round ?? ''
						const raceName = race?.raceName ?? `Round ${round}`
						setProgress(`Loading pit stops: ${season} round ${round}...`)

						const cachedStops = getCachedStops(season, round)
						let raceStops: any[] = Array.isArray(cachedStops) ? cachedStops : []

						if (!cachedStops) {
							let offset = 0
							let total = Infinity

							while (offset === 0 || offset < total) {
								const url = `https://api.jolpi.ca/ergast/f1/${season}/${round}/pitstops.json?limit=${PITSTOP_PAGE_LIMIT}&offset=${offset}`
								const data = await fetchJsonWithBackoff(url)
								const mr = data?.MRData
								total = parseInt(mr?.total ?? '0', 10) || 0
								const stopsPage = mr?.RaceTable?.Races?.[0]?.PitStops ?? []
								raceStops = raceStops.concat(stopsPage)
								if (total === 0) break
								offset += PITSTOP_PAGE_LIMIT
							}

							cacheStops(season, round, raceStops)
						}

						if (raceStops.length === 0) continue
						racesWithStops += 1
						stopsCount += raceStops.length

						raceStops.forEach((stop: any) => {
							const durationField = stop?.duration ?? stop?.Duration // Ergast exposes pit stop length in "duration"
							const durationSeconds = durationToSeconds(durationField)
							if (durationSeconds === null) return
							const stat: PitStopStat = {
								season: String(season),
								round: String(round),
								raceName,
								driverId: stop?.driverId ?? 'unknown',
								lap: String(stop?.lap ?? ''),
								stop: String(stop?.stop ?? ''),
								durationStr: String(durationField ?? ''),
								durationSeconds,
							}

							if (!fastestLocal || durationSeconds < fastestLocal.durationSeconds) fastestLocal = stat
							if (!slowestLocal || durationSeconds > slowestLocal.durationSeconds) slowestLocal = stat
							const driverKey = stat.driverId
							stopsByDriver[driverKey] = (stopsByDriver[driverKey] ?? 0) + 1
							durationByDriver[driverKey] = (durationByDriver[driverKey] ?? 0) + durationSeconds
						})
					}
				}

				if (cancelled) return
				if (!fastestLocal || !slowestLocal) {
					setError('No pit stop data found for the selected range.')
					setTotalStops(stopsCount)
					setTotalRaces(racesWithStops)
					return
				}

				setFastest(fastestLocal)
				setSlowest(slowestLocal)
				setTotalStops(stopsCount)
				setTotalRaces(racesWithStops)
				const ranking = Object.entries(stopsByDriver)
					.map(([driverId, stops]) => ({ driverId, stops, avgSeconds: (durationByDriver[driverId] ?? 0) / Math.max(stops, 1) }))
					.sort((a, b) => b.stops - a.stops)
				setDriverRanking(ranking)
				setProgress('')
			} catch (err) {
				console.error(err)
				setError('Failed to fetch pit stop data. Please try again.')
			} finally {
				if (!cancelled) setLoading(false)
			}
		}

		loadPitstopStats()
		return () => { cancelled = true }
	}, [fromYear, toYear])

	return (
		<div className="dashboard-page">
			<h2>Pitstops</h2>
			<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
				<label>
					From:
					<select value={fromYear} onChange={(e) => handleFromChange(Number(e.target.value))} style={{ marginLeft: '0.35rem' }}>
						{years.map((y) => (
							<option key={y} value={y}>{y}</option>
						))}
					</select>
				</label>
				<label>
					To:
					<select value={toYear} onChange={(e) => handleToChange(Number(e.target.value))} style={{ marginLeft: '0.35rem' }}>
						{years.map((y) => (
							<option key={y} value={y}>{y}</option>
						))}
					</select>
				</label>
			</div>

			<div style={{ marginTop: '0.75rem' }}>
				{loading && <p>Loading pit stop stats... {progress}</p>}
				{!loading && progress && <p>{progress}</p>}
				{error && <p style={{ color: 'red' }}>{error}</p>}
			</div>

			{!loading && !error && (fastest || slowest) && (
				<div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
					<div style={{ fontWeight: 600 }}>Pit stop scan: {fromYear} to {toYear}</div>
					<div>Total pit stops scanned: {totalStops} across {totalRaces} races</div>
					{fastest && (
						<div style={{ border: '1px solid #000', borderRadius: '8px', padding: '0.75rem' }}>
							<div style={{ fontWeight: 600 }}>Fastest pit stop</div>
							<div>{fastest.durationStr}s — {driverNames[fastest.driverId] ?? fastest.driverId} — Season {fastest.season}, Round {fastest.round} ({fastest.raceName}), Lap {fastest.lap}, Stop {fastest.stop}</div>
						</div>
					)}
					{slowest && (
						<div style={{ border: '1px solid #000', borderRadius: '8px', padding: '0.75rem' }}>
							<div style={{ fontWeight: 600 }}>Slowest pit stop</div>
							<div>{slowest.durationStr}s — {driverNames[slowest.driverId] ?? slowest.driverId} — Season {slowest.season}, Round {slowest.round} ({slowest.raceName}), Lap {slowest.lap}, Stop {slowest.stop}</div>
						</div>
					)}
					{driverStopsChart && (
						<div style={{ border: '1px solid #000', borderRadius: '8px', padding: '0.75rem', minHeight: '360px' }}>
							<Bar data={driverStopsChart.data} options={driverStopsChart.options} />
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default Pitstops
