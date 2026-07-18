/**
 * SCC-36 — Operatörslogin. Grön Skyland-identitet: samma mörka botten och
 * varumärkesgrönt som dashboarden och skyland-ai-os. Loggan + glaskort.
 */

import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { login } from '../api';

const GREEN = '#10b981';

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
                background: 'radial-gradient(ellipse at 50% 30%, #0a1f16 0%, #06110c 55%, #030906 100%)',
            }}
        >
            {/* Diskreta gröna auroror — samma känsla som dashboardens bakgrund */}
            <div style={{
                position: 'fixed', inset: 0, pointerEvents: 'none',
                background: `radial-gradient(600px 300px at 20% 15%, rgba(16,185,129,0.07), transparent),
                             radial-gradient(500px 320px at 85% 80%, rgba(16,185,129,0.05), transparent)`,
            }} />

            <motion.form
                onSubmit={handleSubmit}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                style={{
                    width: 360,
                    padding: '40px 34px 34px',
                    borderRadius: 20,
                    background: 'rgba(10, 26, 19, 0.55)',
                    border: '1px solid rgba(16,185,129,0.18)',
                    backdropFilter: 'blur(20px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                    boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.05) inset',
                    color: '#e7fff4',
                    textAlign: 'center',
                }}
            >
                <img
                    src="/logo.png"
                    alt="Skyland"
                    style={{
                        width: 72, height: 72, objectFit: 'contain', marginBottom: 14,
                        filter: 'drop-shadow(0 0 16px rgba(16,185,129,0.5))',
                    }}
                />
                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '0.18em', paddingLeft: '0.18em' }}>
                    SKYLAND
                </div>
                <div style={{
                    fontSize: 11, fontWeight: 600, letterSpacing: '0.35em', paddingLeft: '0.35em',
                    color: GREEN, opacity: 0.8, marginTop: 6, marginBottom: 28, textTransform: 'uppercase',
                }}>
                    Command Center
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
                        padding: '12px 16px',
                        borderRadius: 12,
                        border: `1px solid ${error ? 'rgba(255,107,107,0.5)' : 'rgba(16,185,129,0.25)'}`,
                        background: 'rgba(0,0,0,0.35)',
                        color: '#e7fff4',
                        fontSize: 14,
                        outline: 'none',
                        textAlign: 'center',
                        letterSpacing: '0.1em',
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
                        marginTop: 18,
                        padding: '12px 0',
                        borderRadius: 12,
                        border: 'none',
                        background: busy ? 'rgba(16,185,129,0.4)' : GREEN,
                        color: '#03130c',
                        fontWeight: 800,
                        fontSize: 14,
                        letterSpacing: '0.06em',
                        cursor: busy || !password ? 'default' : 'pointer',
                        boxShadow: busy ? 'none' : '0 6px 24px rgba(16,185,129,0.35)',
                        transition: 'box-shadow 0.2s ease',
                    }}
                >
                    {busy ? 'Loggar in…' : 'Logga in'}
                </button>
            </motion.form>
        </div>
    );
}
