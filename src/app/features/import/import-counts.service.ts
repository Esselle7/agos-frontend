import { Injectable, inject, signal } from '@angular/core';
import { of, switchMap, tap } from 'rxjs';
import { MovimentiService } from '../../core/services/movimenti.service';
import { ContatoreImportDTO, ImportKpiDTO } from '../../core/models/movimenti.models';

/** Contatori per le sezioni di smistamento. */
export interface ImportCounts {
  /** Righe su conto transitorio: dall'11/08/2026 include anche gli Effetti/RiBa (audit §7.7). */
  catalogare: number;
  ricorrenti: number;
  eventi: number;
  /**
   * `null` finché nessuno ha aperto la sezione: l'analisi è O(n²) e sta fuori dal badge, quindi
   * il numero non esiste ancora. Zero e «non misurato» sono due cose diverse e si mostrano diverse.
   */
  duplicati: number | null;
  matchingDifferiti: number;
  /** Righe bancarie fuori dai conti: è denaro, non lavoro d'ufficio — badge ROSSO (audit §7.4). */
  scartati: number;
}

/**
 * Store leggero condiviso dalla pagina "Import & Smistamento": KPI + contatori per i badge della
 * nav laterale + il CONTATORE dell'ultimo import (SPEC import-v2 §6.1). Le sezioni chiamano
 * {@link reload} dopo ogni azione così i badge e la fascia restano allineati.
 * I badge caricano solo i TOTALI (size=1) — non le liste — per essere economici.
 */
@Injectable({ providedIn: 'root' })
export class ImportCountsService {
  private readonly movimenti = inject(MovimentiService);

  readonly kpi = signal<ImportKpiDTO | null>(null);
  readonly counts = signal<ImportCounts>({ catalogare: 0, ricorrenti: 0, eventi: 0, duplicati: null, matchingDifferiti: 0, scartati: 0 });
  readonly loading = signal(false);

  /** L'import a cui si riferiscono contatore e registro: l'ultimo caricato. */
  readonly importCorrente = signal<string | null>(null);
  readonly contatore = signal<ContatoreImportDTO | null>(null);

  /**
   * Tre richieste, non otto. Fino al 13/08/2026 qui partivano 6 liste con `size=1` (usate solo
   * per il loro `totalElements`) + `/import/history` (usata solo per l'id dell'ultimo import) +
   * il contatore. Ogni conferma del wizard le rifaceva tutte, contro un `RateLimitFilter` che in
   * produzione concede 100 richieste/minuto per utente: i badge ora arrivano da `/import/badge`,
   * che porta anche `ultimoImportId` e toglie di mezzo la catena su `/history`.
   */
  reload(): void {
    this.loading.set(true);

    // Il KPI resta separato: è @CacheResult lato server e un suo errore non deve spegnere i badge.
    this.movimenti.getImportKpi().subscribe({ next: k => this.kpi.set(k) });

    // NB: il badge NON include i duplicati: la loro analisi è O(n²) e costosa (~700ms); il
    // conteggio si calcola solo aprendo la sezione "Duplicati" (setDuplicati).
    // I badge si scrivono appena arrivano (tap): se poi il contatore fallisce, la nav resta viva.
    this.movimenti.getImportBadge().pipe(
      tap(b => {
        this.counts.update(c => ({
          ...c,
          catalogare: b.catalogare,
          ricorrenti: b.ricorrenti,
          eventi: b.eventi,
          matchingDifferiti: b.matchingDifferiti,
          scartati: b.scartati,
        }));
        this.importCorrente.set(b.ultimoImportId);
        this.loading.set(false);
      }),
      switchMap(b => b.ultimoImportId ? this.movimenti.getContatoreImport(b.ultimoImportId) : of(null)),
    ).subscribe({
      next: c => this.contatore.set(c),
      error: () => { this.contatore.set(null); this.loading.set(false); },
    });
  }

  /** Aggiorna il badge "Duplicati" solo quando la sezione viene aperta (evita l'O(n²) nei badge). */
  setDuplicati(n: number): void {
    this.counts.update(c => ({ ...c, duplicati: n }));
  }
}
