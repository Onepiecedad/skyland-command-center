/**
 * Smoke: Loading-komponenten renderar utan att krascha och visar text.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Loading, SkeletonLoading } from './Loading';

describe('Loading', () => {
    it('renderar standardtexten', () => {
        render(<Loading />);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('renderar egen text', () => {
        render(<Loading text="Hämtar leads" />);
        expect(screen.getByText('Hämtar leads')).toBeInTheDocument();
    });

    it('SkeletonLoading renderar rätt antal platshållare', () => {
        const { container } = render(<SkeletonLoading count={4} />);
        expect(container.querySelectorAll('.bg-gray-200')).toHaveLength(4);
    });
});
