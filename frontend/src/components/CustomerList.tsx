import { useEffect, useState } from 'react';
import type { Customer } from '../api';
import { fetchCustomers } from '../api';

interface Props {
    selectedCustomerId: string | null;
    onSelectCustomer: (id: string | null, slug: string | null) => void;
}

export function CustomerList({ selectedCustomerId, onSelectCustomer }: Props) {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadCustomers();
    }, []);

    async function loadCustomers() {
        setLoading(true);
        try {
            const data = await fetchCustomers();
            setCustomers(data);
        } catch (err) {
            console.error('Failed to fetch customers:', err);
        }
        setLoading(false);
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'error': return '#ef4444';
            case 'warning': return '#f59e0b';
            case 'active': return '#22c55e';
            default: return '#6b7280';
        }
    };

    const formatTime = (iso: string | null) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('sv-SE');
    };

    return (
        <div className="panel">
            <h2>🏢 Customers</h2>
            {loading ? (
                <p>Loading...</p>
            ) : (
                <div className="customer-list">
                    {customers.map(c => (
                        <div
                            key={c.id}
                            className={`customer-card ${selectedCustomerId === c.id ? 'selected' : ''}`}
                            onClick={() => onSelectCustomer(
                                selectedCustomerId === c.id ? null : c.id,
                                selectedCustomerId === c.id ? null : c.slug
                            )}
                        >
                            <div className="customer-header">
                                <span className="customer-name">{c.name}</span>
                                <span
                                    className="status-badge"
                                    style={{ backgroundColor: getStatusColor(c.status) }}
                                >
                                    {c.status}
                                </span>
                            </div>
                            <div className="customer-meta">
                                <span>slug: {c.slug}</span>
                                <span>🔴 {c.errors_24h} | ⚠️ {c.warnings_24h} | 📋 {c.open_tasks}</span>
                            </div>
                            <div className="customer-activity">
                                Last activity: {formatTime(c.last_activity)}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
