# 18. Scadenzario

> Menu: **Operatività → Scadenzario**. Riservato all'amministratore.

## A cosa serve

Lo Scadenzario è l'**agenda dei soldi**: raccoglie in un'unica pagina tutto ciò che ha una
**data di scadenza** e ti dice cosa è già scaduto, cosa scade a breve e cosa è ancora lontano.
Risponde alla domanda *"cosa devo pagare e incassare, e quando?"*.

È la versione completa del campanellino in alto a destra: quel badge conta le scadenze **già
scadute**; cliccandolo (o aprendo il menu) arrivi qui.

## Le quattro nature

Lo Scadenzario unisce quattro sorgenti diverse, ognuna con il suo colore:

| Natura | Cos'è | Verso |
|---|---|---|
| **Incassi da ricevere** | Movimenti in **entrata** ancora *Da liquidare* (crediti aperti) | + |
| **Fatture da pagare** | Movimenti in **uscita** ancora *Da liquidare* (debiti aperti) | − |
| **Spese ricorrenti** | Le prossime **rate** dei piani ricorrenti | − |
| **Eventi** | Gli eventi con un **residuo** ancora da incassare | + |

> Le voci già saldate/incassate nel periodo restano visibili ma "spente" (etichetta **Saldato**),
> così vedi anche cosa hai già chiuso.

## Le due viste

In alto scegli come guardare i dati:

- **Liste** — quattro colonne (una per natura). In cima a ogni colonna trovi il **totale** ancora
  aperto e il numero di voci **scadute**; le voci scadute sono mostrate per prime.
- **Calendario** — una griglia mensile con le scadenze appoggiate sul giorno. Puoi spostarti tra i
  mesi e **filtrare per natura** (accendi/spegni Eventi, Spese ricorrenti, Fatture, Incassi) per
  ripulire la vista.

## Il periodo

Il selettore **Questo mese / Trimestre / Anno** definisce l'**orizzonte** entro cui mostrare le
scadenze future. Regola importante: **gli scaduti si vedono sempre**, qualunque sia il periodo —
non vuoi che un debito scaduto a gennaio sparisca solo perché stai guardando il trimestre.

## Lo stato di una voce

Ogni riga è etichettata in base alla distanza dalla scadenza:

| Stato | Significato |
|---|---|
| **Scaduto da N gg** | La scadenza è passata e la voce non è ancora chiusa — è il rosso da gestire. |
| **Scade oggi** | Scade in giornata. |
| **Tra N gg** | Mancano pochi giorni (entro una settimana). |
| **Saldato** | Già pagato/incassato nel periodo. |

## I KPI

Sopra le liste trovi i totali di sintesi: quanto hai **da pagare** e **da ricevere** nel periodo,
e quanti **eventi** e quante **rate ricorrenti** sono ancora aperti. Se ci sono scaduti, un banner
ne riassume il numero per natura.

> **Dal 5 agosto 2026 le rate ricorrenti scadute restano qui finché non le confermi.** Prima
> sparivano da sole alla scadenza, perché il sistema le dava per pagate senza chiedere niente alla
> banca. Ora una rata scaduta e ancora in elenco vuol dire una cosa precisa: *in banca quell'addebito
> non è ancora arrivato*. Si chiude collegandola dall'[import](06-import-e-smistamento.md#ricorrenti)
> o pagandola a mano ([§11.4](05-spese-ricorrenti.md)).

## Come si usa

1. Apri **Scadenzario** (o clicca il **campanellino** in alto a destra quando è acceso).
2. Parti dagli **scaduti**: sono in cima alle liste e nel banner. Sono i soldi su cui agire subito.
3. Guarda l'**orizzonte** scelto per capire cosa arriva a breve.
4. Per agire vai alla sezione giusta: paghi/incassi un movimento in [Movimenti](03-movimenti.md),
   registri un incasso evento in [Eventi](04-eventi.md), gestisci una rata in
   [Spese ricorrenti](05-spese-ricorrenti.md).

## Attenzione

- Lo Scadenzario è di **sola lettura**: mostra le scadenze, non le chiude. La voce sparisce (o
  diventa *Saldato*) quando registri il pagamento/incasso nella sezione dedicata.
- Una voce "scaduta" non è un errore del sistema: è un promemoria che quella cosa andava già
  pagata o incassata.

---

[← 8. Dashboard](02-dashboard.md) · [Indice](README.md) · **Prossimo:** [9. Movimenti →](03-movimenti.md)
