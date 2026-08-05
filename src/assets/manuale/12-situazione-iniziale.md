# 19. Situazione iniziale

> Menu: **Configurazione → Situazione iniziale**. Riservata all'amministratore.

## A cosa serve

È l'**apertura del gestionale**: la fotografia del giorno da cui parte tutto. Serve a far partire i
conti "giusti" — senza dover ricaricare lo storico dei movimenti passati. La compili una volta sola,
all'avvio; poi ci torni solo se hai un dato nuovo da inserire.

Ogni sezione è **facoltativa**: compila quello che hai, quando ce l'hai. Il dettaglio dei movimenti
passati **non serve**: bastano i saldi e le poste ancora aperte a quella data.

La pagina è divisa in sei sezioni, scelte dalla barra a sinistra.

## La data di apertura

In cima alla pagina c'è **un solo campo data**, che vale per tutta la situazione iniziale: saldi,
crediti e debiti partono dallo stesso giorno. Di default è **oggi**; puoi cambiarla, ma **non può
essere una data futura** (non esiste il saldo di domani). Finché è futura, i pulsanti di salvataggio
restano disabilitati.

> **Perché una sola data.** Se i saldi partissero da un giorno e i crediti/debiti da un altro, la
> vista dei soldi e quella dei costi/ricavi partirebbero da due istanti diversi e non quadrerebbero
> mai. Sceglila una volta, all'inizio, e non toccarla più.

---

## 19.1 Liquidità — i saldi alla data di apertura

**A cosa serve:** dire al gestionale quanti soldi avevi in ciascun conto quel giorno. È la base di
partenza della cassa.

> **Perché conta.** Il saldo che vedi in giro per il gestionale è sempre
> *saldo iniziale + somma dei movimenti*. Se il saldo iniziale è zero, i saldi saranno sbagliati di
> tutta la liquidità che avevi prima di partire.

**Passo passo**

1. Per ogni conto (BPM, Crédit Agricole, Cassa) inserisci il **saldo alla data di apertura**.
   Usa il **saldo contabile** dell'estratto conto — quello che stampa la banca, verificabile su un
   documento. Per la cassa, il contante **contato**, non quello ricordato.
2. Premi **Salva** su ogni riga. Il bollino verde conferma il salvataggio.

> **Contabile o disponibile?** Sull'estratto conto ci sono due numeri: il *contabile* (tutte le
> operazioni registrate) e il *disponibile* (il contabile meno ciò che non puoi ancora usare). Qui
> va il **contabile**. Quello che tu sai e la banca no — un assegno che hai firmato e che nessuno ha
> ancora incassato — non sta in nessuno dei due: lo registri come **debito di apertura** (§19.4).

Ricordati i conti che non usi tutti i giorni (Satispay, Stripe): se restano a zero per dimenticanza,
il totale della liquidità nasce sbagliato.

---

## 19.2 Cespiti — il libro dei beni durevoli

**A cosa serve:** registrare i **beni durevoli** ancora in ammortamento (forno, arredi, macchine,
lavori, impianti). Sono ciò che genera il costo **"ammortamento"** nel conto economico.

> **Perché conta.** L'ammortamento è un costo che pesa sull'utile **senza muovere soldi**: spalma
> il valore di un bene sugli anni di vita. Se non carichi i cespiti, il P&L 2026 non avrà gli
> ammortamenti e l'utile risulterà più alto del reale. Vedi
> [Parte I, cap. 6](01-capire-il-gestionale.md#6-cosa-non-e-un-costo-o-un-ricavo).

**Passo passo**

1. **Aggiungi cespite.**
2. Compila:
   - **Descrizione** (es. "Lavastoviglie professionale").
   - **Conto (categoria investimento)** — la categoria del piano dei conti sotto cui rientra
     (codici `50.xx`). Se manca, con **+ Aggiungi categoria** ne crei una al volo.
   - **Costo storico** — quanto è costato il bene.
   - **Aliquota ammortamento** — la percentuale annua (es. 25% → vita 4 anni). L'anteprima ti mostra
     subito l'ammortamento **al mese** e **all'anno** e la vita stimata.
   - **Data acquisto.**
3. **Salva cespite.**

La lista mostra, per ogni bene, l'ammortamento annuo e il **valore residuo**. In fondo trovi il
**totale ammortamento annuo** e la sua quota mensile nel P&L. Quando un bene arriva a fine vita,
l'ammortamento smette automaticamente.

---

## 19.3 Crediti da incassare

**A cosa serve:** i soldi che i **clienti ti devono** alla data di apertura (eventi o fatture non
ancora incassati).

> **Perché conta — e perché NON sono ricavo dell'anno in corso.** Sono crediti maturati *prima*
> dell'apertura: quando li incassi **muovono la cassa** ma **non** contano come ricavo dell'esercizio
> in corso. Tecnicamente sono movimenti in entrata *Da liquidare* registrati con **competenza al
> 31/12 dell'anno precedente** all'apertura — l'etichetta "Apertura <anno>" che vedi su ogni riga.
>
> Non è un dettaglio estetico: il conto economico somma **per mese**, quindi una competenza dentro
> il mese di apertura farebbe comparire il credito pregresso tra i ricavi di quel mese. Spostandola
> all'anno prima, il P&L dell'esercizio in corso resta pulito.

**Passo passo:** **Aggiungi credito** → cliente e causale, importo, scadenza prevista, categoria
ricavo → **Aggiungi**. In fondo vedi il totale dei crediti aperti.

---

## 19.4 Debiti da pagare

**A cosa serve:** le **fatture fornitori da pagare** alla data di apertura (es. un saldo fornitore
aperto), gli assegni emessi e non ancora incassati, i bonifici disposti e non ancora partiti.

> **Perché conta — e perché NON sono costo dell'anno in corso.** Specularmente ai crediti: quando li
> paghi **escono dalla cassa** ma **non** contano come costo dell'esercizio in corso (competenza al
> 31/12 dell'anno precedente).

**Passo passo:** **Aggiungi debito** → fornitore e causale, importo, scadenza prevista, categoria
costo → **Aggiungi**.

---

## 19.5 Finanziamenti e mutui

Mutui, leasing e finanziamenti già in corso **non si inseriscono qui**: si gestiscono come
**[spese ricorrenti](05-spese-ricorrenti.md)**, partendo dal **debito residuo alla data di apertura**.

> Nel conto economico entra **solo la quota interessi** delle rate; la quota capitale è
> rimborso di un debito, non un costo
> ([Parte I, cap. 6](01-capire-il-gestionale.md#6-cosa-non-e-un-costo-o-un-ricavo)).

> ⚠️ **Data della prima rata.** Impostala **dopo** la data di apertura. Se la metti prima, il
> generatore automatico crea anche le rate del passato — rate già pagate che risulterebbero da pagare.

La sezione contiene solo questa spiegazione e un collegamento a Spese ricorrenti.

---

## 19.6 Rimanenze di magazzino

Il valore delle scorte alla data di apertura (cantina, spaccio, food) è una posta dello stato
patrimoniale che il gestionale **non traccia**: serve per il bilancio della commercialista, non per
i KPI di cassa e margine di questo strumento.

Chiedi alla commercialista il **valore delle rimanenze a quella data** e tienilo come riferimento;
**non va inserito qui** perché non alimenta nessun calcolo del gestionale.

---

## Attenzione

- La **data di apertura** si sceglie in cima alla pagina, vale per tutte le sezioni e non può essere
  futura. Sui **saldi** è solo un'etichetta (il saldo è sempre *saldo iniziale + somma movimenti*,
  senza filtro di data); sulle **partite** decide invece in quale esercizio finiscono, quindi
  sceglila prima di inserire crediti e debiti.
- Crediti e debiti di apertura **non gonfiano** il conto economico dell'esercizio in corso: li vedi
  però nello [Scadenzario](13-scadenzario.md) finché non li chiudi, perché sono soldi che devono
  ancora muoversi.
- **I mesi precedenti all'apertura restano vuoti.** Se il gestionale è partito a metà anno, il P&L
  dell'anno mostra zero fino a quel giorno: non è un errore di calcolo, è che quel periodo non è
  coperto. La pagina Reporting te lo segnala da sola quando scegli un intervallo che inizia prima.

---

[← 10. Eventi](04-eventi.md) · [Indice](README.md) · **Prossimo:** [14. Anagrafica →](08-anagrafica.md)
