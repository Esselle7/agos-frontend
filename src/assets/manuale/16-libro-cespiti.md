# 22. Libro cespiti

> Menu: **Contabilità → Libro cespiti**. Riservato all'amministratore.

## A cosa serve

Registrare i **beni durevoli acquistati durante l'anno** (forno, lavastoviglie, arredi, macchine,
impianti) e impostarne l'**ammortamento**. È il gemello "operativo" del libro cespiti che trovi
nella [Situazione iniziale](12-situazione-iniziale.md#192-cespiti--il-libro-dei-beni-durevoli):

- **Situazione iniziale → Cespiti** = i beni **già posseduti** prima del gestionale (fotografia al
  31/12/2025).
- **Libro cespiti** (questa pagina) = i beni che **compri adesso**, con tanto di uscita di cassa.

> **Perché un cespite non è un costo.** Quando compri un bene da €10.000 i soldi **escono subito**
> dalla banca o dalla cassa (è un **investimento / uscita finanziaria**, CAPEX), ma **non** è un
> costo del conto economico. Il costo entra nel P&L **un po' al mese** come **ammortamento**,
> spalmato sulla vita utile che scegli (es. €10.000 in 2 anni = €416,67/mese). Vedi
> [Parte I, cap. 6](01-capire-il-gestionale.md#6-cosa-non-e-un-costo-o-un-ricavo).

---

## 22.1 Registrare un acquisto

**A cosa serve:** capitalizzare un nuovo bene **e**, in un colpo solo, generare la relativa uscita.

### Passo passo

1. **Registra acquisto.**
2. Compila:
   - **Descrizione** (es. "Lavastoviglie professionale").
   - **Categoria investimento (CAPEX)** — il conto del [piano dei conti](14-piano-conti.md) sotto cui
     rientra l'investimento.
   - **Costo** — quanto è costato il bene.
   - **Durata ammortamento** — in **anni** (es. 2 anni → €10.000 diventano €416,67/mese).
     L'anteprima mostra subito l'ammortamento **al mese** e **all'anno**.
   - **Data acquisto** e **Business Unit**.
3. Scegli **come è stato pagato**:
   - **Pagato subito** → scegli **con quale conto** (BPM, Crédit Agricole, Cassa). Ogni conto mostra
     il **saldo disponibile**: se non copre il costo, è **disabilitato** e non puoi sceglierlo (la
     stessa guardia *fondi insufficienti* vale anche sul server). Nasce un'uscita **già pagata**.
   - **Pagherò dopo (da liquidare)** → l'uscita nasce **da liquidare**: la salderai più avanti (vedi
     §22.3).
4. **Registra acquisto.**

**Cosa succede:** nascono insieme il **cespite** (nel libro) e il **movimento di uscita** CAPEX
collegato. Da subito il bene comincia ad ammortizzare secondo la durata scelta.

---

## 22.2 Leggere il libro

La tabella elenca ogni bene con: **costo**, **vita** (anni), **ammortamento/anno**, quanto è **già
ammortizzato**, il **valore residuo** e lo **stato del pagamento** dell'acquisto:

| Badge | Significato |
|---|---|
| **Pagato** | L'acquisto è stato liquidato (uscita registrata). |
| **Da liquidare** | L'uscita è aperta: il fornitore non è ancora stato pagato. |

In fondo trovi il **totale ammortamento annuo** dei beni attivi e la sua **quota mensile** nel P&L.
Quando un bene arriva a fine vita, l'ammortamento **si ferma da solo**.

---

## 22.3 Liquidare o eliminare

- **Liquidare (💰):** disponibile solo sui cespiti **Da liquidare**. Registra il pagamento
  dell'acquisto, portando lo stato a **Pagato**.
- **Eliminare (🗑):** possibile finché l'acquisto **non è ancora stato pagato**. Un cespite con
  acquisto **già pagato non è eliminabile** (annullerebbe un'uscita reale già in contabilità): in
  quel caso il bene resta nel libro.

---

## Errori comuni / attenzione

- **Registrare un acquisto di cespite come costo diretto o spesa.** Un bene durevole **non** è un
  costo: usalo qui, così pesa sul P&L come ammortamento e non tutto nel mese d'acquisto.
- **Confondere questa pagina con la Situazione iniziale.** Qui vanno i beni **comprati durante
  l'anno**; i beni già posseduti a fine 2025 stanno nel [libro iniziale](12-situazione-iniziale.md#192-cespiti--il-libro-dei-beni-durevoli).
- **Scegliere un conto che non copre il costo.** Il conto è disabilitato apposta: se il saldo non
  basta, il pagamento non parte.

---

[← 11. Spese ricorrenti](05-spese-ricorrenti.md) · [Indice](README.md) · **Prossimo:** [19. Situazione iniziale →](12-situazione-iniziale.md)
