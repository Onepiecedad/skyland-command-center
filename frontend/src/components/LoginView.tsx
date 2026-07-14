/**
 * SCC-36 — Operatörslogin. Visas när varken VITE-token (dev) eller
 * sessioncookie (prod) autentiserar. Följer glassmorphism-temat.
 */

import { useState, type FormEvent } from 'react';
import { login } from '../api';

interface LoginViewProps {
    onSuccess: () => void;
}

export function LoginView({ onSuccess }: LoginViewProps) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!password || busy) return;
        setBusy(true);
        setError(null);
        const result = await login(password);
        setBusy(false);
        if (result.ok) {
            onSuccess();
        } else {
            setError(result.error || 'Fel lösenord');
            setPassword('');
        }
    };

    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'radial-gradient(ellipse at top, #10132a 0%, #05060f 70%)',
            }}
        >
            <form
                onSubmit={handleSubmit}
                style={{
                    width: 340,
                    padding: '36px 32px',
                    borderRadius: 16,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    backdropFilter: 'blur(12px)',
                    color: '#e8eaf6',
                    textAlign: 'center',
                }}
            >
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>Skyland</div>
                <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4, marginBottom: 24 }}>
                    Command Center — operatörslogin
                </div>

                <input
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Lösenord"
                    autoComplete="current-password"
                    style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: 'rgba(0,0,0,0.35)',
                        color: '#e8eaf6',
                        fontSize: 14,
                        outline: 'none',
                    }}
                />

                {error && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#ff8a80' }}>{error}</div>
                )}

                <button
                    type="submit"
                    disabled={busy || !password}
                    style={{
                        width: '100%',
                        marginTop: 16,
                        padding: '10px 0',
                        borderRadius: 10,
                        border: 'none',
                        background: busy ? 'rgba(124,140,255,0.4)' : '#7c8cff',
                        color: '#0b0b0f',
                        fontWeight: 700,
                        fontSize: 14,
                        cursor: busy || !password ? 'default' : 'pointer',
                    }}
                >
                    {busy ? 'Loggar in…' : 'Logga in'}
                </button>
            </form>
        </div>
    );
}
