/**
 * Smoke + interaktion: SegmentedControl renderar segmenten och anropar
 * onSelect med rätt nyckel vid klick.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from './SegmentedControl';

const segments = [
    { key: 'crm', label: 'CRM' },
    { key: 'leads', label: 'Leads' },
    { key: 'costs', label: 'Kostnader' },
];

describe('SegmentedControl', () => {
    it('renderar alla segment-etiketter', () => {
        render(<SegmentedControl segments={segments} activeKey="crm" onSelect={() => {}} />);
        expect(screen.getByText('CRM')).toBeInTheDocument();
        expect(screen.getByText('Leads')).toBeInTheDocument();
        expect(screen.getByText('Kostnader')).toBeInTheDocument();
    });

    it('anropar onSelect med nyckeln för det klickade segmentet', () => {
        const onSelect = vi.fn();
        render(<SegmentedControl segments={segments} activeKey="crm" onSelect={onSelect} />);

        fireEvent.click(screen.getByText('Leads'));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('leads');
    });
});
