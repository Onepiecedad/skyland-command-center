/**
 * CollapsibleMarkdown — långa agent-svar (rapporter, tabeller, dumpar) collapsas
 * till ett kort med förhandsvisning + "Visa hela". Det är dessa som gör chatten
 * mil-lång — inte konversationen. Korta svar renderas orörda.
 */

import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronUp } from 'lucide-react';

const CHAR_LIMIT = 1400;
const LINE_LIMIT = 18;
const PREVIEW_CHARS = 600;

const remarkPlugins = [remarkGfm];

interface CollapsibleMarkdownProps {
    content: string;
}

export const CollapsibleMarkdown = memo(function CollapsibleMarkdown({ content }: CollapsibleMarkdownProps) {
    const [expanded, setExpanded] = useState(false);
    const lines = content.split('\n').length;
    const isLong = content.length > CHAR_LIMIT || lines > LINE_LIMIT;

    if (!isLong) {
        return <ReactMarkdown remarkPlugins={remarkPlugins}>{content}</ReactMarkdown>;
    }

    if (expanded) {
        return (
            <>
                <ReactMarkdown remarkPlugins={remarkPlugins}>{content}</ReactMarkdown>
                <button className="msg-collapse-btn" onClick={() => setExpanded(false)}>
                    <ChevronUp size={13} /> Visa mindre
                </button>
            </>
        );
    }

    // Förhandsvisning: klipp vid närmaste radbrytning efter PREVIEW_CHARS
    const cut = content.indexOf('\n', PREVIEW_CHARS);
    const preview = content.slice(0, cut > 0 ? cut : PREVIEW_CHARS);

    return (
        <>
            <div className="msg-collapsed-preview">
                <ReactMarkdown remarkPlugins={remarkPlugins}>{preview}</ReactMarkdown>
            </div>
            <button className="msg-collapse-btn" onClick={() => setExpanded(true)}>
                <ChevronDown size={13} /> Visa hela svaret ({lines} rader)
            </button>
        </>
    );
});
