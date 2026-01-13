import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addRecentSearch } from './recentSearches'
import type { RecentSearch } from './recentSearches'

/**
 * Syncs a single string value with a URL search param
 */
export function useStringParam(key: string, defaultValue: string = ''): [string, (value: string) => void] {
    const [searchParams, setSearchParams] = useSearchParams()

    const [value, setValue] = useState(() => searchParams.get(key) ?? defaultValue)

    // Sync from URL to state
    useEffect(() => {
        const raw = searchParams.get(key)
        if (raw !== null && raw !== value) setValue(raw)
    }, [searchParams, key])

    // Sync from state to URL
    const updateValue = useCallback((newValue: string) => {
        setValue(newValue)
        const newParams = new URLSearchParams(searchParams)
        if (newValue === '' || newValue === defaultValue) {
            newParams.delete(key)
        } else {
            newParams.set(key, newValue)
        }
        setSearchParams(newParams, { replace: true })
    }, [searchParams, setSearchParams, key, defaultValue])

    return [value, updateValue]
}

/**
 * Syncs a single number value with a URL search param
 */
export function useNumberParam(key: string, defaultValue: number): [number, (value: number) => void] {
    const [searchParams, setSearchParams] = useSearchParams()

    const getInitial = (): number => {
        const raw = searchParams.get(key)
        if (raw === null) return defaultValue
        const num = Number(raw)
        return Number.isFinite(num) ? num : defaultValue
    }

    const [value, setValue] = useState(getInitial)

    // Sync from URL to state
    useEffect(() => {
        const raw = searchParams.get(key)
        if (raw === null) return
        const num = Number(raw)
        if (Number.isFinite(num) && num !== value) setValue(num)
    }, [searchParams, key])

    // Sync from state to URL
    const updateValue = useCallback((newValue: number) => {
        setValue(newValue)
        const newParams = new URLSearchParams(searchParams)
        newParams.set(key, String(newValue))
        setSearchParams(newParams, { replace: true })
    }, [searchParams, setSearchParams, key])

    return [value, updateValue]
}

type RecentSearchConfig = {
    type: RecentSearch['type']
    label: string
    path: string
    condition: boolean
}

/**
 * Records a recent search when condition becomes true
 */
export function useRecordSearch(config: RecentSearchConfig): void {
    const { type, label, path, condition } = config

    useEffect(() => {
        if (condition) {
            addRecentSearch({ type, label, path })
        }
    }, [condition, type, label, path])
}
