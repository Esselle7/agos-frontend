# 15. Report e Previsioni

> Menu: **Analisi → Report** e **Analisi → Previsioni**. Riservate all'amministratore.

Qui leggi i risultati. **Report** guarda al **passato e al presente** (cos'è successo);
**Previsioni** guarda al **futuro** (cosa succederà alla cassa e all'utile). Per interpretarle ti
serve la [Parte I](01-capire-il-gestionale.md) (waterfall, tre date, famiglie di conto).

---

## 15.1 Report → P&L Comparativo

**A cosa serve:** leggere il **conto economico** (il [waterfall](01-capire-il-gestionale.md#3-il-conto-economico))
confrontando i periodi e le Business Unit.

### Cosa mostra

- La cascata completa: **Ricavi → Costi op. → EBITDA → EBIT → Utile Netto**, con il **Margine %**.
- Un **Totale Consolidato** e la ripartizione **per Business Unit** (Ricavi vs Costi per BU,
  Margine % per BU).
- È la stessa logica della [Parte I, cap. 3](01-capire-il-gestionale.md#3-il-conto-economico):
  ogni riga è alimentata dalla famiglia di conto corrispondente.

> ⚠️ **I mesi prima dell'apertura sono vuoti, e va bene così.** Il gestionale conosce solo i
> movimenti registrati dalla [data di apertura](12-situazione-iniziale.md) in poi. Se scegli un
> periodo che inizia prima, quei mesi risultano a **zero**: non è un errore di calcolo, è che quel
> periodo non è coperto. La pagina te lo segnala con un avviso e ti indica la data di partenza.
> Per un confronto sensato, scegli un intervallo che parte dall'apertura.
>
> Le **partite di apertura** (crediti e debiti pregressi) non compaiono qui: hanno competenza
> nell'anno precedente proprio per non falsare questo prospetto. Le trovi nello
> [Scadenzario](13-scadenzario.md).

### Come si legge

1. **Report → P&L Comparativo.**
2. Scegli il **periodo** da analizzare.
3. Parti dall'**EBITDA** e dal suo **margine %**: ti dice se l'attività "pura" rende.
4. Scendi a **EBIT** (dopo gli ammortamenti) e all'**Utile Netto** (dopo interessi e imposte).
5. Confronta le **Business Unit**: scopri quale area traina e quale pesa.

> Ricorda: qui **non** entrano i giroconti né la quota capitale dei finanziamenti
> ([Parte I, cap. 6](01-capire-il-gestionale.md#6-cosa-non-e-un-costo-o-un-ricavo)). Se un numero
> sembra "mancare", probabilmente è una di queste voci, che per definizione non sono costi/ricavi.

---

## 15.2 Esportare i dati

Lo scarico dei dati per la commercialista non vive più dentro Report: ha una sezione propria,
**[Esporta dati](15-export.md)**, oggi in ricostruzione. Vedi quel capitolo per lo stato e per cosa
arriverà.

---

## 15.3 Previsioni (forecasting)

**A cosa serve:** proiettare **entrate e uscite future** partendo dai dati già nel sistema. Risponde
a *"avrò abbastanza cassa nei prossimi mesi?"* e *"come sta andando l'anno rispetto alle attese?"*.

### Certo vs stima — il concetto chiave

La previsione distingue due livelli di affidabilità:

- **CERTO** — ciò che è già **contrattualizzato**: il residuo degli eventi confermati, le rate
  ricorrenti, gli stipendi, i movimenti da liquidare con scadenza futura. Sono soldi che, salvo
  imprevisti, si muoveranno per davvero.
- **STIMA** — i **ricavi cash ricorrenti** (cassa ristorante, spaccio) che non hanno un contratto
  ma si ripetono. Sono proiettati su **base storica**: la media per **giorno della settimana** delle
  **ultime 8 settimane**, fino a un massimo di **+90 giorni**.

Il pulsante **Includi stime** (acceso di default) aggiunge o toglie il layer STIMA. Con le stime
spente vedi solo il certo.

### Da dove prende i numeri (il certo)

| Fonte | Cosa proietta |
|---|---|
| **Movimenti da liquidare** | Incassi/pagamenti registrati con scadenza futura ancora aperti |
| **Eventi confermati** | Il **residuo** ancora da incassare (preventivo − già incassato) |
| **Rate ricorrenti** | Le rate future dei piani (con la quota interessi) |
| **Stipendi** | Le mensilità del personale in arrivo |

> Per non contare due volte, gli incassi degli eventi sono proiettati **solo** tramite il residuo
> dell'evento, non come singoli movimenti.

### Gli orizzonti

Puoi proiettare a **30, 60, 90, 180 giorni** o fino a **fine anno**. La previsione parte da domani.

### Come è fatta la pagina

1. **Situazione Attuale (AS IS)** — i KPI di oggi: **Liquidità Attuale** (conti + cassa), **Ricavi /
   Costi / EBITDA YTD**, **Crediti Aperti** (da incassare) e **Debiti Aperti** (da pagare).
2. **Proiezione nel Periodo** — il grafico della liquidità nel tempo: l'**area blu** è il saldo sul
   solo certo; la **linea arancione tratteggiata** (se le stime sono attive) aggiunge i ricavi cash
   stimati — è lo scenario "combinato"; la **tratteggiata verde** è l'EBITDA per periodo (scala a
   destra).
3. **Riepilogo Previsionale** — due schede: **Economica** (ricavi e costi di competenza, fino
   all'EBITDA/EBIT) e **Finanziaria** (saldo oggi → incassi − uscite → saldo finale). Quando le
   stime sono attive, mostrano anche la riga "di cui stimato" e il totale combinato.
4. **Timeline Finanziaria** — la stessa proiezione in tabella, periodo per periodo.
5. **Dettaglio Voci Previsionali** — l'elenco riga per riga, filtrabile per categoria (Movimenti,
   Eventi, Spese ricorrenti, Stipendi); ogni voce è marcata **Certo** o **Stima**.

---

## Errori comuni / attenzione

- **Confondere P&L e cassa.** Il P&L Comparativo dice quanto *guadagni*; le Previsioni (vista
  Finanziaria) dicono quanti *soldi* avrai. Sono entrambe necessarie.
- **Previsioni "vuote".** Se non vedi nulla, probabilmente non ci sono movimenti da liquidare,
  eventi confermati con residuo o rate pending nel periodo scelto: le previsioni si nutrono di
  quei dati. Tieni aggiornati eventi e rate.
- **Numeri non aggiornati al secondo.** I report derivano da viste che si aggiornano
  periodicamente; un dato appena inserito può comparire con un piccolo ritardo.

---

[← 20. Piano dei conti](14-piano-conti.md) · [Indice](README.md) · **Prossimo:** [21. Esporta dati →](15-export.md)
