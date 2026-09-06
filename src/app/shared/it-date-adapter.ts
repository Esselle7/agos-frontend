import { Injectable } from '@angular/core';
import { NativeDateAdapter } from '@angular/material/core';

/**
 * Adapter data italiano: serve SOLO a leggere una data DIGITATA a mano.
 *
 * `NativeDateAdapter.parse()` ignora `MAT_DATE_LOCALE` e delega a `Date.parse()`, che è a
 * semantica americana. Conseguenza misurata il 05/09/2026 sul form movimenti: digitando
 * `01/07/2026` (1 luglio) il campo mostrava `01/07/2026` ma il calendario si apriva su GEN 2026
 * — il form control conteneva il 7 gennaio. Silenzioso quando il giorno è ≤ 12 (le due cifre si
 * scambiano senza errore), rumoroso sopra (`25/12/2026` non è una data valida in en-US e il
 * campo andava in errore di parsing). Le date scritte a mano finiscono in `data_movimento`
 * (mese di competenza del P&L), `data_finanziaria` (saldi) e `data_liquidita` (scadenzario):
 * il mese sbagliato sposta i numeri senza che nessuno se ne accorga.
 *
 * Qui si accetta solo il formato dell'app — D/M/YYYY con separatore `/`, `-` o `.` — e si
 * costruisce la data a mezzogiorno come fa il `NativeDateAdapter` (evita gli slittamenti di
 * fuso). Tutto il resto (calendario, `format`, `deserialize` dell'ISO che arriva dal backend)
 * resta quello di Material.
 */
@Injectable()
export class ItDateAdapter extends NativeDateAdapter {
  override parse(value: unknown): Date | null {
    if (typeof value !== 'string') return super.parse(value);

    const m = value.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (!m) return super.parse(value);

    const [, g, mese, anno] = m.map(Number) as unknown as [string, number, number, number];

    // Una data inesistente deve risultare INVALIDA, non scivolare al mese dopo né far esplodere
    // il campo: `createDate` lancia su un giorno fuori range, quindi si valida prima.
    const prova = new Date(anno, mese - 1, g);
    const esiste = prova.getFullYear() === anno && prova.getMonth() === mese - 1 && prova.getDate() === g;
    return esiste ? this.createDate(anno, mese - 1, g) : new Date(NaN);
  }
}
