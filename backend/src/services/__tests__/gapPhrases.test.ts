/**
 * Backstoppen för saknade förmågor får varken tiga när Alex säger att han inte
 * kan, eller larma när han bara redovisar ett vanligt fel. Fraserna testas här
 * mot riktiga formuleringar ur kvällens loggar.
 */
import { describe, it, expect } from 'vitest';
import { GAP_PHRASES, looksLikeGap } from '../alexBrain';

const matches = (s: string) => GAP_PHRASES.some((re) => re.test(s));

describe('GAP_PHRASES', () => {
    it('fångar när Alex säger att förmågan saknas', () => {
        expect(matches('Det uppdraget kan jag tyvärr inte utföra eftersom det ligger utanför mina tillgängliga funktioner.')).toBe(true);
        expect(matches('Jag har inget verktyg för att läsa kalendern.')).toBe(true);
        expect(matches('Jag har inget sätt att se när senaste besökaren var på sidan.')).toBe(true);
        expect(matches('Jag saknar åtkomst till Metas annonsstatistik.')).toBe(true);
        // Ordagrant ur ett skarpt test 9 sep — den här formuleringen gled förbi först.
        expect(matches('Jag har ingen tillgång till att visa eller boka saker i din kalender.')).toBe(true);
        expect(matches('Jag har ingen funktion för att läsa SMS.')).toBe(true);
    });

    it('larmar inte på vanliga fel eller lyckade svar', () => {
        expect(matches('Det ligger tolv prospekt i pipelinen just nu.')).toBe(false);
        expect(matches('Uppdraget gick inte iväg: gatewayen svarar inte.')).toBe(false);
        expect(matches('Jag har uppdaterat kortet för LOA Ink.')).toBe(false);
        expect(matches('Kunde inte köa uppdraget: databasen svarade med ett fel.')).toBe(false);
        expect(matches('Gustav har inte tillgång till kortet än, men det är på väg.')).toBe(false);
    });
});

describe('looksLikeGap — bredare nät när inget verktyg ens försökte', () => {
    it('fångar nya formuleringar när Alex inte lyfte ett finger', () => {
        // Ordagrant ur ett skarpt test 9 sep.
        expect(looksLikeGap('Tyvärr kan jag inte öppna externa appar som Spotify eller spela musik.', 0)).toBe(true);
        expect(looksLikeGap('Det där kunde jag inte göra åt dig.', 0)).toBe(true);
    });

    it('tiger när verktyg faktiskt kördes — då är det ett fel, inte en lucka', () => {
        expect(looksLikeGap('Jag kan inte flytta kortet, tabellen svarade med ett fel.', 2)).toBe(false);
    });

    it('tiger på vanlig försiktighet', () => {
        expect(looksLikeGap('Jag kan inte lova att Gustav svarar i kväll.', 0)).toBe(false);
        expect(looksLikeGap('Jag kan tyvärr inte garantera norrsken.', 0)).toBe(false);
    });

    it('fångar den uttalade luckan även när verktyg kördes', () => {
        expect(looksLikeGap('Jag har inget verktyg för att läsa kalendern.', 3)).toBe(true);
    });
});
