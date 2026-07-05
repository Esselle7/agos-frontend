# 20. Piano dei conti

> Menu: **Configurazione → Piano dei conti**. Riservato all'amministratore.

## A cosa serve

Il piano dei conti è l'elenco dei **conti COGE** (contabilità generale) usati in tutta
l'applicazione: ogni movimento, evento, spesa e riga di report è agganciato a uno di questi conti.
È l'impalcatura che alimenta il [waterfall del conto economico](01-capire-il-gestionale.md#3-il-conto-economico).

Qui li **consulti** e, all'occorrenza, ne **modifichi** uno o ne **aggiungi** di nuovi.

## Come sono organizzati

I conti sono raggruppati per **natura**, ciascuno con il suo colore e la sua icona:

| Gruppo | Cos'è | Dove pesa |
|---|---|---|
| **Ricavi** | Le entrate di competenza | Riga Ricavi del P&L |
| **Costi** | I costi operativi | EBITDA |
| **Attività** | Beni e crediti (patrimoniale) | Fuori dal P&L |
| **Passività** | Debiti (patrimoniale) | Fuori dal P&L |
| **Oneri finanziari** | Interessi su mutui/finanziamenti | Tra EBITDA ed EBIT/EBT |
| **Imposte** | Tributi e imposte | Verso l'utile netto |

Dentro ogni gruppo i conti sono mostrati **ad albero**: i conti "padre" (in grassetto) contengono i
loro sotto-conti, rientrati verso destra. Il **codice** (es. `30.01.001`) resta visibile come piccola
targhetta, ma è la **descrizione** a guidare la lettura. La barra di ricerca in alto filtra per nome o
codice, mantenendo visibili i conti padre per non perdere il contesto.

## Aggiungere un conto

Il **Nuovo conto** (o **Aggiungi** dentro un gruppo, che preseleziona la natura) apre una finestra a
**due pannelli**: a sinistra l'inserimento guidato, a destra l'anteprima dal vivo di dove finirà.

A sinistra, in tre passi:

1. **Che natura ha?** — scegli l'insieme (Ricavi, Costi, Attività, Passività, Oneri finanziari,
   Imposte) toccando la sua scheda colorata.
2. **Come si chiama?** — il nome del conto (es. «Vendita torte da asporto»).
3. **In quale gruppo?** (facoltativo) — il conto padre, scelto **per nome**, non per numero.

A destra vedi l'albero dell'insieme/ramo scelto con la **nuova voce già al suo posto**, evidenziata e
col codice **generato in automatico** (il prossimo numero libero). L'anteprima si aggiorna mentre
scegli: cambi natura → cambia l'insieme; scegli il padre → la voce scende come figlia; scrivi il nome
→ la label si aggiorna. Non devi mai digitare il codice.

Premi **Crea.** Se nel frattempo quel numero fosse stato occupato, il sistema te ne prepara subito uno
nuovo: basta premere di nuovo **Crea**.

## Modificare un conto

Clicca sulla riga del conto. Di norma cambi solo il **nome**. Il **codice** è mostrato bloccato:
per modificarlo apri **Modifica codice (avanzato)** — è un'operazione delicata (vedi Attenzione).

## Attenzione

- **Cambiare un codice ha effetti a cascata.** Il codice è la chiave con cui movimenti, regole di
  riconoscimento e [keyword](07-keyword.md) si agganciano al conto: se lo modifichi, il sistema
  aggiorna i riferimenti collegati, ma è un'operazione delicata. Cambialo solo se sai cosa stai
  facendo.
- Non eliminare conti già usati da movimenti storici: rischi di "orfanare" dati passati. In dubbio,
  lascia il conto e creane uno nuovo.
- I nuovi conti non entrano automaticamente in tutte le liste di previsione/forecasting: alcune
  selezioni sono ancora definite a livello di sistema.

---

[← 13. Regole di classificazione](07-keyword.md) · [Indice](README.md) · **Prossimo:** [15. Report e Previsioni →](09-reporting-e-previsioni.md)
