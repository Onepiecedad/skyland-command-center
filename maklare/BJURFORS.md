# Bjurfors Mölndal — vad du gör

Allt är byggt och utrullat. Det som återstår är att ladda datan och skapa agenten.
Två kommandon, cirka tio minuter, plus verifiering.

## 1. Ladda objekt

```
cd ~/skyland-command-center/maklare
MK_SECRET=$(cat ~/mk_secret.txt) python3 ladda-bjurfors-objekt.py
```

Sitemapen är 6,5 MB med 32 000 URL:er. Den hämtas och filtreras på din maskin,
inte i edge-funktionen — funktionen slog i CPU-taket när den försökte. Den får en
färdig lista på 40 URL:er per anrop i stället.

Runt 15 batchar, tre till fem minuter. Varje batch skrivs ut medan den körs.

**Läs SUMMA-raden.** `objekt skrivna` ska ligga runt 35–40 och `misslyckade
sidor` på noll. Blir `annat kontor` hela urvalet listas kontorsnamnen längst ner
— då stavas kontoret annorlunda i deras data och jag rättar filtret.

## 1b. Kunskapsbasen (redan klar)

18 sidor, 151 chunks, indexerade. Behöver bara köras om när Bjurfors ändrar
innehållet:

```
MK_SECRET=$(cat ~/mk_secret.txt) bash ladda-bjurfors.sh
```

## 2. Skapa agenten

```
read -s ELEVEN_KEY
export ELEVEN_KEY MK_SECRET
bash satt-upp-bjurfors.sh
```

Skapar fem nya verktyg som pekar på `bjurfors-molndal`, och en ny agent med samma
prompt, samma röst (Anna) och samma spärrar som HusmanHagberg-agenten.
HusmanHagberg-agenten rörs inte.

Öppna länken skriptet skriver ut, tryck Publish, testa i widgeten.

## 3. Leadvyn

`leadvy.html` har fått Bjurfors i rullgardinen. Samma nyckel, byt bara byrå.

---

## Innan du bokar mötet — läs det här

Petter på HusmanHagberg Mölndal och Rasmus Broström på Bjurfors Mölndal är
konkurrenter i samma stad. Två saker följer av det:

**Nämn inte den ena för den andra.** Inte som referens, inte som "jag visade det här
för HusmanHagberg i går". Det gör dig till någon som pratar om sina kunder.

**Visa aldrig den andras data.** Agenterna är skilda tenants med radnivåspärr i
databasen, så det kan inte läcka av misstag — men leadvyn har en rullgardin, och
det är du som klickar. Kolla vilken byrå som står i den innan du delar skärm.

Om någon av dem frågar rakt ut om du jobbar med andra mäklare: svara ärligt att du
bygger för branschen och att varje byrås data ligger isolerad. Det är ett starkare
svar än att slingra sig.

## Om Rasmus

Rasmus Broström, fastighetsmäklare och senior partner på Bjurfors Mölndal. Av de
objekt kontoret har till salu i Mölndal står han ensam för drygt hälften. Det gör
honom till rätt person att visa det här för — han har mest att vinna på att inte
missa samtal, och tillräckligt mycket att säga till om.

Vinkeln som biter på honom är inte "AI" utan volym: han kan inte svara i telefon
under en visning, och varje missat samtal från en spekulant är en spekulant som
ringer nästa mäklare i stället.
