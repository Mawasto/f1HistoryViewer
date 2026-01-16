import { useState } from 'react'
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import '../styles/AuthModal.css'

type AuthModalProps = {
    isOpen: boolean
    onClose: () => void
}

// Simple hash function for password (in production, use proper hashing on backend)
const hashPassword = async (password: string): Promise<string> => {
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

const AuthModal = ({ isOpen, onClose }: AuthModalProps) => {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [mode, setMode] = useState<'login' | 'register'>('login')
    const { setUser } = useAuth()

    const validateEmail = (email: string) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    }

    const handleRegister = async () => {
        setError('')

        if (!email || !password) {
            setError('Please fill in all fields')
            return
        }

        if (!validateEmail(email)) {
            setError('Please enter a valid email address')
            return
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters')
            return
        }

        setLoading(true)

        try {
            // Check if user already exists
            const usersRef = collection(db, 'users')
            const q = query(usersRef, where('email', '==', email.toLowerCase()))
            const querySnapshot = await getDocs(q)

            if (!querySnapshot.empty) {
                setError('An account with this email already exists')
                setLoading(false)
                return
            }

            // Hash password and create user
            const hashedPassword = await hashPassword(password)
            const docRef = await addDoc(usersRef, {
                email: email.toLowerCase(),
                password: hashedPassword,
                createdAt: new Date().toISOString(),
            })

            setUser({ email: email.toLowerCase(), uid: docRef.id })
            setEmail('')
            setPassword('')
            onClose()
        } catch (err) {
            console.error('Registration error:', err)
            setError('Failed to register. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const handleLogin = async () => {
        setError('')

        if (!email || !password) {
            setError('Please fill in all fields')
            return
        }

        setLoading(true)

        try {
            const usersRef = collection(db, 'users')
            const q = query(usersRef, where('email', '==', email.toLowerCase()))
            const querySnapshot = await getDocs(q)

            if (querySnapshot.empty) {
                setError('No account found with this email')
                setLoading(false)
                return
            }

            const userDoc = querySnapshot.docs[0]
            const userData = userDoc.data()

            // Verify password
            const hashedPassword = await hashPassword(password)
            if (userData.password !== hashedPassword) {
                setError('Incorrect password')
                setLoading(false)
                return
            }

            setUser({ email: userData.email, uid: userDoc.id })
            setEmail('')
            setPassword('')
            onClose()
        } catch (err) {
            console.error('Login error:', err)
            setError('Failed to login. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (mode === 'login') {
            handleLogin()
        } else {
            handleRegister()
        }
    }

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose()
        }
    }

    if (!isOpen) return null

    return (
        <div className="auth-modal-overlay" onClick={handleOverlayClick}>
            <div className="auth-modal">
                <button className="auth-modal-close" onClick={onClose} aria-label="Close">
                    &times;
                </button>
                <h2 className="auth-modal-title">
                    {mode === 'login' ? 'Login' : 'Register'}
                </h2>
                <form onSubmit={handleSubmit} className="auth-form">
                    <div className="auth-input-group">
                        <label htmlFor="auth-email">Email</label>
                        <input
                            id="auth-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter your email"
                            disabled={loading}
                            autoComplete="email"
                        />
                    </div>
                    <div className="auth-input-group">
                        <label htmlFor="auth-password">Password</label>
                        <input
                            id="auth-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            disabled={loading}
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        />
                    </div>
                    {error && <p className="auth-error">{error}</p>}
                    <div className="auth-buttons">
                        <button
                            type="submit"
                            className="auth-btn auth-btn-primary"
                            disabled={loading}
                        >
                            {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Register'}
                        </button>
                    </div>
                </form>
                <div className="auth-switch">
                    {mode === 'login' ? (
                        <p>
                            Don't have an account?{' '}
                            <button
                                type="button"
                                className="auth-switch-btn"
                                onClick={() => { setMode('register'); setError('') }}
                            >
                                Register
                            </button>
                        </p>
                    ) : (
                        <p>
                            Already have an account?{' '}
                            <button
                                type="button"
                                className="auth-switch-btn"
                                onClick={() => { setMode('login'); setError('') }}
                            >
                                Login
                            </button>
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}

export default AuthModal