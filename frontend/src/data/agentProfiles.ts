/**
 * Rollformulär (à la Drakar & Demoner) för Alex + alla sub-agenter.
 * Innehållet är destillerat ur spec-filerna i openclaw-config
 * (RESEARCHER_SPEC_V1, DM_WRITER_SPEC_V1, ORCHESTRATOR_SPEC_V1 m.fl.).
 * Avatarer: /public/agents/<id>.png (main: /avatars/alex.png).
 */

export interface AgentProfile {
    id: string;
    name: string;
    /** Klass — rollens arketyp */
    klass: string;
    /** Kort epitet under namnet */
    epithet: string;
    avatar: string;
    /** Vilken LLM som driver agenten (visas som "själ") */
    model: string;
    /** Uppdraget i en mening */
    purpose: string;
    /** Förmågor — vad rollen är bra på */
    abilities: string[];
    /** Verktyg rollen får använda */
    tools: string[];
    /** Eder — det rollen ALDRIG får göra */
    oaths: string[];
    /** Rapporterar till */
    reportsTo: string;
}

export const AGENT_PROFILES: Record<string, AgentProfile> = {
    main: {
        id: 'main',
        name: 'Alex',
        klass: 'Koordinator',
        epithet: 'Mästarhjärnan — din högra hand i Skyland',
        avatar: '/avatars/alex.png',
        model: 'kimi-k2.5',
        purpose: 'Tar emot Joakims uppdrag, delegerar till rätt specialist, håller ihop helheten och rapporterar tillbaka i klartext.',
        abilities: ['Delegering & orkestrering', 'CRM-åtkomst (scc-crm)', 'Skills & sub-agenter', 'Minne över sessioner'],
        tools: ['sessions_spawn', 'exec', 'file_read/write', 'scc-crm', 'web_search'],
        oaths: ['Skickar aldrig extern kommunikation utan godkännande', 'Letar aldrig upp nycklar eller skriver secrets i chatten', 'Gissar aldrig CRM-siffror — frågar alltid systemet'],
        reportsTo: 'Joakim (operatör)',
    },
    orchestrator: {
        id: 'orchestrator',
        name: 'Orchestrator',
        klass: 'Pipelinekontrollant',
        epithet: 'Deterministisk flödesväktare',
        avatar: '/agents/orchestrator.png',
        model: 'kimi-k2.5',
        purpose: 'Startar godkända V1-pipelines, håller stegen i ordning och ser till att inget hoppar över granskning.',
        abilities: ['Pipeline-sekvensering', 'Readiness-kontroller', 'Återrouting vid fel'],
        tools: ['sessions_spawn', 'exec', 'file_read/write/list'],
        oaths: ['Startar aldrig icke-godkända flöden', 'Kringgår aldrig approval-regler'],
        reportsTo: 'Alex (main)',
    },
    researcher: {
        id: 'researcher',
        name: 'Researcher',
        klass: 'Faktajägare',
        epithet: 'Verifierade fakta, inga gissningar',
        avatar: '/agents/researcher.png',
        model: 'deepseek-v4-flash · low effort',
        purpose: 'Samlar företagsdata om leads och prospekt — sajter, IG, omdömen — och levererar bara det som går att belägga.',
        abilities: ['Webbresearch', 'Källkritik', 'Lead-berikning'],
        tools: ['web_search', 'web_fetch', 'browser', 'exec', 'file_read'],
        oaths: ['Rapporterar aldrig hypoteser som fakta', 'Kontaktar aldrig leads'],
        reportsTo: 'Orchestrator / Alex',
    },
    'research-librarian': {
        id: 'research-librarian',
        name: 'Research-librarian',
        klass: 'Källväktare',
        epithet: 'Bevisens bibliotekarie',
        avatar: '/agents/research-librarian.png',
        model: 'deepseek-v4-flash · low effort',
        purpose: 'Rankar källors trovärdighet, arkiverar bevis och håller research-biblioteket rent från skräp.',
        abilities: ['Källrankning', 'Evidenshantering', 'Arkivering'],
        tools: ['web_search', 'web_fetch', 'file_read/write'],
        oaths: ['Godkänner aldrig overifierade källor', 'Raderar aldrig bevismaterial'],
        reportsTo: 'Researcher / Alex',
    },
    analyst: {
        id: 'analyst',
        name: 'Analyst',
        klass: 'Poängmästare',
        epithet: 'ICP-score och beslutsunderlag',
        avatar: '/agents/analyst.png',
        model: 'deepseek-v4-flash · low effort',
        purpose: 'Sätter ICP-score på prospekt enligt den viktade modellen och avgör vilka som är värda outreach.',
        abilities: ['ICP-scoring (V1-modellen)', 'Beslutslogik', 'Datakvalitetskontroll'],
        tools: ['exec', 'file_read/write'],
        oaths: ['Ändrar aldrig scoringmodellen på egen hand', 'Poängsätter aldrig utan verifierad data'],
        reportsTo: 'Orchestrator / Alex',
    },
    'strategy-analyst': {
        id: 'strategy-analyst',
        name: 'Strategy-analyst',
        klass: 'Strateg',
        epithet: 'Ser helheten, ifrågasätter riktningen',
        avatar: '/agents/strategy-analyst.png',
        model: 'kimi-k2.5',
        purpose: 'Stöttar affärsriktningen — utvärderar vad som fungerar i tratten och föreslår strategiska justeringar.',
        abilities: ['Affärsanalys', 'Trattutvärdering', 'Riktningsrekommendationer'],
        tools: ['file_read/write'],
        oaths: ['Fattar aldrig affärsbeslut — föreslår bara', 'Döljer aldrig osäkerhet i underlag'],
        reportsTo: 'Alex (main)',
    },
    writer: {
        id: 'writer',
        name: 'Writer',
        klass: 'Skrivare',
        epithet: 'Interna texter, sammanfattningar, dokument',
        avatar: '/agents/writer.png',
        model: 'kimi-k2.5',
        purpose: 'Skriver interna sammanfattningar, briefer och dokument — allt som inte går till kund.',
        abilities: ['Sammanfattning', 'Dokumentstruktur', 'Klarspråk'],
        tools: ['exec', 'file_read/write'],
        oaths: ['Skriver aldrig kundriktad text (det är dm-writers jobb)', 'Publicerar aldrig utan granskning'],
        reportsTo: 'Alex (main)',
    },
    'dm-writer': {
        id: 'dm-writer',
        name: 'DM-writer',
        klass: 'Utkastsmed',
        epithet: 'Joakims röst i första kontakten',
        avatar: '/agents/dm-writer.png',
        model: 'kimi-k2.5',
        purpose: 'Skriver granskningsklara outreach-utkast enligt dm-stilguiden: en verifierad detalj, en ärlig fråga, ingen pitch i öppnaren.',
        abilities: ['DM-hantverk (dm-stil.md)', 'Personalisering på verifierade fakta', 'Kanalval'],
        tools: ['file_read/write', 'dm_pipeline (validerad)'],
        oaths: ['Skickar ALDRIG själv — Joakim granskar och skickar', 'Hittar aldrig på personaliseringsdetaljer', 'Använder aldrig länkar i öppnaren'],
        reportsTo: 'Joakim via Alex',
    },
    lyra: {
        id: 'lyra',
        name: 'Lyra',
        klass: 'Promptvävare',
        epithet: 'Formar orden som styr de andra',
        avatar: '/agents/lyra.png',
        model: 'kimi-k2.5 (vilande — ej registrerad i openclaw.json)',
        purpose: 'Förfinar prompts och instruktioner för övriga agenter — när en roll slirar är det Lyra som vässar receptet.',
        abilities: ['Promptdesign', 'Instruktionsanalys', 'Utvärdering av agentbeteende'],
        tools: ['file_read/write'],
        oaths: ['Ändrar aldrig en agents regler utan operatörens godkännande'],
        reportsTo: 'Joakim via Alex',
    },
};
