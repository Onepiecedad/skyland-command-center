// ============================================================================
// Skills API — Registry, lifecycle, checker (Tickets 11.1–11.4)
// ============================================================================
import { API_BASE, fetchWithAuth } from './base';
import type { Skill, SkillMatch } from './types';

export async function fetchSkills(): Promise<{ skills: Skill[]; count: number; enabled_count?: number; disabled_count?: number }> {
    const res = await fetchWithAuth(`${API_BASE}/skills`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function fetchSkillDetail(name: string): Promise<{ skill: Skill }> {
    const res = await fetchWithAuth(`${API_BASE}/skills/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function enableSkill(name: string): Promise<{ status: string; skill: string; enabled: boolean }> {
    const res = await fetchWithAuth(`${API_BASE}/skills/${encodeURIComponent(name)}/enable`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function disableSkill(name: string): Promise<{ status: string; skill: string; enabled: boolean }> {
    const res = await fetchWithAuth(`${API_BASE}/skills/${encodeURIComponent(name)}/disable`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function dryRunSkill(name: string): Promise<{
    skill: string;
    valid: boolean;
    checks: Array<{ check: string; passed: boolean; detail?: string }>;
}> {
    const res = await fetchWithAuth(`${API_BASE}/skills/${encodeURIComponent(name)}/dry-run`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function checkSkills(task: string, agentId?: string): Promise<{
    task: string;
    matches: SkillMatch[];
    match_count: number;
}> {
    const res = await fetchWithAuth(`${API_BASE}/skills/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, agent_id: agentId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function validateSkill(name: string): Promise<{
    skill_name: string;
    usable: boolean;
    checks: Array<{ check: string; passed: boolean; detail?: string }>;
}> {
    const res = await fetchWithAuth(`${API_BASE}/skills/${encodeURIComponent(name)}/validate`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}
