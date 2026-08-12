import { Injectable, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { MovimentiService } from '../../core/services/movimenti.service';
import { ImportKpiDTO } from '../../core/models/movimenti.models';

/** Contatori per le sezioni di smistamento. */
export interface ImportCounts {
  /** Righe su conto transitorio: dall'11/08/2026 include anche gli Effetti/RiBa (audit §7.7). */
  catalogare: number;
  ricorrenti: number;
  eventi: number;
  duplicati: number;
  matchingDifferiti: number;
  /** Righe bancarie fuori dai conti: è denaro, non lavoro d'ufficio — badge ROSSO (audit §7.4). */
  scartati: number;
}

/**
 * Store leggero condiviso dalla pagina "Import & Smistamento": KPI + contatori per i badge della
 * nav laterale. Le sezioni chiamano {@link reload} dopo ogni azione così i badge restano allineati.
 * Carica solo i TOTALI (size=1) — non le liste — per essere economico.
 */
@Injectable({ providedIn: 'root' })
export class ImportCountsService {
  private readonly movimenti = inject(MovimentiService);

  readonly kpi = signal<ImportKpiDTO | null>(null);
  readonly counts = signal<ImportCounts>({ catalogare: 0, ricorrenti: 0, eventi: 0, duplicati: 0, matchingDifferiti: 0, scartati: 0 });
  readonly loading = signal(false);

  reload(): void {
    this.loading.set(true);
    // NB: i badge usano SOLO COUNT veloci (size=1). L'analisi-duplicati è O(n²) e costosa
    // (~700ms): NON va nei badge; il suo conteggio si calcola solo aprendo la sezione "Duplicati".
    forkJoin({
      kpi: this.movimenti.getImportKpi(),
      catalogare: this.movimenti.getTransitori(undefined, 0, 1),
      ricorrenti: this.movimenti.getRicorrenti('DA_RICONCILIARE', 0, 1),
      eventi: this.movimenti.getEventiParcheggiati('DA_RICONCILIARE', 0, 1),
      matchingDifferiti: this.movimenti.getMatchingDifferiti('DA_RICONCILIARE', 0, 1),
      scartati: this.movimenti.getScartati('DA_VEDERE', 0, 1),
    }).subscribe({
      next: r => {
        this.kpi.set(r.kpi);
        this.counts.update(c => ({
          ...c,
          catalogare: r.catalogare.totalElements,
          ricorrenti: r.ricorrenti.totalElements,
          eventi: r.eventi.totalElements,
          matchingDifferiti: r.matchingDifferiti.totalElements,
          scartati: r.scartati.totalElements,
        }));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Aggiorna il badge "Duplicati" solo quando la sezione viene aperta (evita l'O(n²) nei badge). */
  setDuplicati(n: number): void {
    this.counts.update(c => ({ ...c, duplicati: n }));
  }
}
