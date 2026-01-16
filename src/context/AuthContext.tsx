import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type User = {
    email: string
    uid: string
}

type AuthContextType = {
    user: User | null
    setUser: (user: User | null) => void
    loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Check for saved user in localStorage on mount
        const savedUser = localStorage.getItem('f1viewer_user')
        if (savedUser) {
            try {
                setUser(JSON.parse(savedUser))
            } catch {
                localStorage.removeItem('f1viewer_user')
            }
        }
        setLoading(false)
    }, [])

    useEffect(() => {
        // Persist user to localStorage
        if (user) {
            localStorage.setItem('f1viewer_user', JSON.stringify(user))
        } else {
            localStorage.removeItem('f1viewer_user')
        }
    }, [user])

    return (
        <AuthContext.Provider value={{ user, setUser, loading }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}