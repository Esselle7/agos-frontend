# 12. Import & smistamento

> Menu: **Contabilità → Import & smistamento**. Riservata all'amministratore.

Questa è la sezione che ti fa risparmiare più tempo: invece di inserire i movimenti a mano, **carichi
i file** che ti danno la banca e il registratore di cassa, e il sistema li trasforma in movimenti
già classificati. Quello che non riesce a classificare con certezza te lo mette da parte nella
**console di smistamento**, dove lo sistemi tu con pochi clic.

La pagina ha una **barra KPI** in alto (righe importate, % contabilizzate, da smistare, copertura
fornitori) e un menu laterale diviso in **operazioni** (Importa, Storico) e **Smistamento**
(Da catalogare, Quadratura POS, Effetti/RiBa, Ricorrenti, Eventi, Duplicati).

---

## 12.1 Come funziona l'import (il concetto)

L'import lavora su **tre file dello stesso periodo**, riconciliati insieme:

- **Billy (Registratore di Cassa)** — i corrispettivi / incassi POS.
- **Banco BPM** — i movimenti del conto corrente BPM.
- **Crédit Agricole** — i movimenti del conto corrente CA.

> **Perché tre insieme?** Le **banche** danno la "ossatura" certa (banca, data, importo); **Billy**
> arricchisce gli incassi con la categoria (cosa è stato venduto). Riconciliandoli si evita di
> contare due volte lo stesso incasso (quello che il cliente paga col POS appare sia su Billy sia
> sull'accredito in banca).

Ogni riga dei file attraversa una **pipeline** che la smista in uno di questi esiti:

| Esito | Cosa significa | Dove finisce |
|---|---|---|
| **Scartata** | Rumore non contabile (giroconti tra i tuoi conti, righe POS già conteggiate) | Esclusa, mai a libro |
| **Movimento riconosciuto** | Il sistema ha capito conto, BU e controparte | Diventa subito un movimento |
| **Transitorio (da catalogare)** | Diventa movimento ma su un conto "provvisorio" perché la controparte è ignota | Sezione **Da catalogare** |
| **Ambigua (da rivedere)** | Il sistema ha più interpretazioni possibili | Da rivedere |
| **Parcheggiata** | Probabile incasso evento o rata ricorrente: non diventa subito movimento | Sezioni **Eventi** / **Ricorrenti** |

Il tuo lavoro post-import è **svuotare le sezioni di smistamento**.

---

## 12.2 Caricare i 3 file (operazione: Importa)

### Passo passo

1. **Import & smistamento → Importa.**
2. Trascina (o seleziona) i tre file nelle rispettive caselle:
   - **Billy (Registratore Cassa)** — corrispettivi (`.csv` / `.xlsx`).
   - **Banco BPM** — MovimentiCC (`.csv`).
   - **Crédit Agricole** — Movimenti (`.csv`).
3. Quando tutte e tre le caselle sono piene, clicca **Importa i 3 file**.
4. Leggi il **riepilogo dell'esito** (vedi sotto).
5. Clicca **Vai allo smistamento** per lavorare ciò che è rimasto da sistemare.

### Leggere l'esito dell'import

Il riepilogo elenca:

- **Movimenti importati** — quanti sono diventati subito movimenti.
- **Ambiguità** — righe da rivedere.
- **Eventi parcheggiati** e **Spese ricorrenti parcheggiate** — da riconciliare nelle sezioni
  dedicate.
- **Righe escluse (POS/giroconti)** — scartate volutamente.
- **Duplicati saltati** — righe già importate in passato (il sistema non le ri-conta).
- **Righe con errori** — con il dettaglio espandibile riga per riga.
- eventuali **avvisi** (es. scontrini Billy esclusi perché agriturismo → modulo Eventi, o in attesa
  di accredito → li riprenderà il prossimo import).

> **Reimportare lo stesso file non crea doppioni:** il sistema riconosce le righe già viste e le
> salta (compaiono come "duplicati").

---

## 12.3 La console di smistamento

Ogni sezione del menu **Smistamento** mostra un badge col numero di voci ancora da lavorare.

### Da catalogare (i transitori)

Sono movimenti finiti su un conto **provvisorio** perché il sistema non ha riconosciuto la
controparte. Per ciascuno:

1. Apri la voce: vedi descrizione, importo, IBAN, intestatario.
2. Assegna **Conto CoGe**, **Business Unit** e (se serve) **Fornitore**.
3. Spunta **Apprendi keyword** se vuoi che la prossima volta una riga simile venga catalogata da
   sola (vedi [capitolo 13](07-keyword.md)).
4. **Cataloga.**

→ Il movimento esce dai transitori e, se hai appreso la keyword, il sistema imparerà a riconoscerlo.

### Effetti / RiBa

Stessa logica dei transitori, ma per **effetti e ricevute bancarie** (RiBa). Si catalogano allo
stesso modo.

### Ricorrenti

Righe che assomigliano a **rate di un piano di spesa ricorrente** (mutui, finanziamenti, leasing,
canoni, assicurazioni, bolli). L'import le riconosce **dalla descrizione** e le mette da parte:
**non diventano movimenti da sole**, perché il modulo Spese ricorrenti è la fonte di verità.

Tre azioni, in ordine di preferenza:

- **Collega** *(la via giusta quando il piano esiste)* — scegli **piano** e **rata**. Due casi, e il
  gestionale li distingue da solo:
  - la rata è **ancora da pagare** → la paga usando la **data reale dell'addebito in banca**, non la
    data di scadenza teorica;
  - la rata **risulta già pagata** (il piano l'aveva già generata alla scadenza) → **non crea niente**,
    la riga si aggancia al movimento che c'è già.

  In entrambi i casi resta **un solo movimento** per quell'addebito. L'etichetta di ogni rata nella
  tendina ti dice in anticipo quale dei due casi è.
- **Conferma** — crea un movimento **isolato**, scegliendo il conto CoGe. Serve quando **non c'è un
  piano** a cui agganciare la riga: tipicamente per una rata pagata prima che il piano fosse creato.
  Attenzione: se il piano esiste, questa strada **duplica** l'uscita — usa Collega.
- **Ignora** — la riga non va contabilizzata.

> **Perché serve.** Il piano genera i movimenti delle rate **alla data di scadenza**, che la banca
> abbia addebitato o no. L'estratto conto è l'unico che sa la verità: *Collega* è il punto in cui i
> due si incontrano.

### Eventi

**Incassi parcheggiati** che sembrano caparre/acconti/saldi di cerimonie. Per ciascuno puoi:

- **Riconcilia** — collegalo all'evento giusto (diventa il pagamento dell'evento);
- **Registra** — trasformalo in movimento;
- **Scarta** — se non è davvero un incasso evento.

> Gli incassi evento sono **parcheggiati** apposta: così sei tu a decidere a quale cerimonia
> appartengono, evitando errori di attribuzione.

### Duplicati

Coppie di righe **sospette di essere lo stesso movimento** (es. lo stesso incasso visto da due
fonti). Le esamini e decidi quale tenere.

---

## 12.4 Quadratura POS

**A cosa serve:** far quadrare gli incassi POS di **Billy** con gli accrediti reali sui conti
(BPM/CA) **a livello di periodo**, non scontrino per scontrino.

In pratica verifichi che il totale incassato col POS in un periodo corrisponda a quanto la banca ti
ha effettivamente accreditato (al netto delle commissioni), e il sistema ripartisce le differenze.
È il pannello che ti dà la certezza che "i soldi del POS sono arrivati".

> La verità di riferimento per gli incassi è **Billy**; le banche confermano gli accrediti.

---

## 12.5 Storico import

La sezione **Storico** elenca gli import già effettuati, con i loro esiti, per consultazione e
controllo.

---

## Errori comuni / attenzione

- **Caricare file di periodi diversi insieme.** I tre file devono coprire **lo stesso periodo**:
  serve a riconciliarli correttamente.
- **Lasciare le sezioni di smistamento piene.** Finché ci sono transitori "Da catalogare", una
  parte dei movimenti resta su conti provvisori e i report non sono completi. Punta a portare il
  badge a zero.
- **Catalogare senza apprendere.** Se una controparte tornerà spesso, spunta **Apprendi keyword**:
  catalogarla una volta ti evita di rifarlo a ogni import.

---

[← 9. Movimenti](03-movimenti.md) · [Indice](README.md) · **Prossimo:** [11. Spese ricorrenti →](05-spese-ricorrenti.md)
