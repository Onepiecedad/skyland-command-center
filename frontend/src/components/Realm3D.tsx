import { useEffect, useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { fetchCustomers, type Customer } from '../api';
import * as THREE from 'three';

// ==============================================================================
// Types
// ==============================================================================

interface Realm3DProps {
    onSelectCustomer: (id: string | null, slug: string | null) => void;
    selectedCustomerId: string | null;
}

interface CustomerNodeProps {
    customer: Customer;
    position: [number, number, number];
    isSelected: boolean;
    onSelect: (id: string, slug: string) => void;
}

// ==============================================================================
// Status color mapping
// ==============================================================================

function getStatusColor(status: Customer['status']): string {
    switch (status) {
        case 'active':
            return '#22c55e'; // green
        case 'warning':
            return '#f97316'; // orange
        case 'error':
            return '#ef4444'; // red
        default:
            return '#6b7280'; // gray fallback
    }
}

// ==============================================================================
// CustomerNode - Individual 3D node for a customer
// ==============================================================================

function CustomerNode({ customer, position, isSelected, onSelect }: CustomerNodeProps) {
    const meshRef = useRef<THREE.Mesh>(null);
    const [hovered, setHovered] = useState(false);

    // Gentle floating animation
    useFrame((state) => {
        if (meshRef.current) {
            meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime + position[0]) * 0.1;
            meshRef.current.rotation.y += 0.005;
        }
    });

    const color = getStatusColor(customer.status);
    const scale = isSelected ? 1.3 : hovered ? 1.15 : 1;

    return (
        <group position={position}>
            <mesh
                ref={meshRef}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(customer.id, customer.slug);
                }}
                onPointerOver={(e) => {
                    e.stopPropagation();
                    setHovered(true);
                    document.body.style.cursor = 'pointer';
                }}
                onPointerOut={() => {
                    setHovered(false);
                    document.body.style.cursor = 'default';
                }}
                scale={scale}
            >
                <sphereGeometry args={[0.5, 32, 32]} />
                <meshStandardMaterial
                    color={color}
                    emissive={color}
                    emissiveIntensity={isSelected ? 0.5 : hovered ? 0.3 : 0.15}
                    roughness={0.3}
                    metalness={0.7}
                />
            </mesh>

            {/* Selection ring */}
            {isSelected && (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.7, 0.8, 32]} />
                    <meshBasicMaterial color={color} transparent opacity={0.6} />
                </mesh>
            )}

            {/* Tooltip on hover */}
            {hovered && (
                <Html
                    position={[0, 1, 0]}
                    center
                    style={{
                        pointerEvents: 'none',
                        userSelect: 'none',
                    }}
                >
                    <div
                        style={{
                            background: 'rgba(10, 10, 15, 0.9)',
                            color: '#f8fafc',
                            padding: '12px 16px',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontFamily: 'Inter, system-ui, sans-serif',
                            whiteSpace: 'nowrap',
                            border: `2px solid ${color}`,
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                        }}
                    >
                        <div style={{ fontWeight: 'bold', marginBottom: '6px', color }}>
                            {customer.name}
                        </div>
                        <div style={{ opacity: 0.7, marginBottom: '4px' }}>
                            slug: {customer.slug}
                        </div>
                        <div>
                            <span style={{ color: '#94a3b8' }}>Open tasks:</span>{' '}
                            <span style={{ fontWeight: 'bold' }}>{customer.open_tasks}</span>
                        </div>
                    </div>
                </Html>
            )}
        </group>
    );
}

// ==============================================================================
// Scene - Contains lighting and all customer nodes
// ==============================================================================

interface SceneProps {
    customers: Customer[];
    selectedCustomerId: string | null;
    onSelectCustomer: (id: string, slug: string) => void;
}

function Scene({ customers, selectedCustomerId, onSelectCustomer }: SceneProps) {
    // Arrange customers in a triangle/circle around origin
    const positions = customers.map((_, index): [number, number, number] => {
        const angle = (index * 2 * Math.PI) / Math.max(customers.length, 1) - Math.PI / 2;
        const radius = 2;
        return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
    });

    return (
        <>
            {/* Lighting */}
            <ambientLight intensity={0.4} />
            <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
            <directionalLight position={[-3, 3, -3]} intensity={0.3} />

            {/* Grid helper for visual reference */}
            <gridHelper args={[10, 10, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.03)']} />

            {/* Customer nodes */}
            {customers.map((customer, index) => (
                <CustomerNode
                    key={customer.id}
                    customer={customer}
                    position={positions[index]}
                    isSelected={customer.id === selectedCustomerId}
                    onSelect={onSelectCustomer}
                />
            ))}

            {/* Controls */}
            <OrbitControls
                enablePan={false}
                minDistance={3}
                maxDistance={10}
                maxPolarAngle={Math.PI / 2.2}
            />
        </>
    );
}

// ==============================================================================
// Realm3D - Main exported component
// ==============================================================================

export function Realm3D({ onSelectCustomer, selectedCustomerId }: Realm3DProps) {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        async function loadCustomers() {
            try {
                const data = await fetchCustomers();
                if (mounted) {
                    setCustomers(data);
                    setLoading(false);
                }
            } catch (err) {
                if (mounted) {
                    setError(err instanceof Error ? err.message : 'Failed to load customers');
                    setLoading(false);
                }
            }
        }

        loadCustomers();
        return () => { mounted = false; };
    }, []);

    const handleSelect = (id: string, slug: string) => {
        // Toggle selection: clicking same customer deselects
        if (id === selectedCustomerId) {
            onSelectCustomer(null, null);
        } else {
            onSelectCustomer(id, slug);
        }
    };

    return (
        <div className="panel realm-panel">
            <div className="panel-header">
                <h2>🌐 3D Realm</h2>
                <span className="badge">{customers.length} nodes</span>
            </div>

            <div className="realm-canvas-container">
                {loading && (
                    <div className="realm-loading">Loading 3D realm...</div>
                )}
                {error && (
                    <div className="realm-error">Error: {error}</div>
                )}
                {!loading && !error && (
                    <Canvas
                        camera={{ position: [0, 3, 6], fov: 50 }}
                        style={{ background: 'linear-gradient(180deg, #000000 0%, #0a0a0f 100%)' }}
                    >
                        <Scene
                            customers={customers}
                            selectedCustomerId={selectedCustomerId}
                            onSelectCustomer={handleSelect}
                        />
                    </Canvas>
                )}
            </div>

            <div className="realm-footer">
                <span>🟢 Active</span>
                <span>🟠 Warning</span>
                <span>🔴 Error</span>
            </div>
        </div>
    );
}
