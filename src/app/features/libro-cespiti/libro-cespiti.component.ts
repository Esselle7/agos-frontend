import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin } from 'rxjs';
import { CespitiService } from '../../core/services/cespiti.service';
import { LookupService } from '../../core/services/lookup.service';
import { CespiteDTO, PianoContiCogeDTO } from '../../core/models/anagrafica.models';
import { EuroPipe } from '../../shared/pipes/euro.pipe';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { CespiteAcquistoDialogComponent } from './cespite-acquisto-dialog.component';
import { CespiteLiquidazioneDialogComponent } from './cespite-liquidazione-dialog.component';

/**
 * Libro cespiti (acquisti nuovi): i beni durevoli acquistati durante l'operatività,
 * ciascuno col suo movimento di spesa CAPEX collegato. I beni già posseduti al go-live
 * restano nel libro iniziale (Situazione iniziale → Cespiti).
 */
@Component({
  selector: 'app-libro-cespiti',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule, MatButtonModule, MatDialogModule, MatProgressSpinnerModule,
    MatTooltipModule, EuroPipe, HelpNoteComponent,
  ],
  templateUrl: './libro-cespiti.component.html',
  styleUrls: ['./libro-cespiti.component.scss'],
})
export class LibroCespitiComponent implements OnInit {
  private readonly cespitiSvc = inject(CespitiService);
  private readonly lookup = inject(LookupService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly loading = signal(true);
  private readonly tutti = signal<CespiteDTO[]>([]);
  readonly contiCapex = signal<PianoContiCogeDTO[]>([]);

  /** Solo gli acquisti operativi: cespiti col movimento di acquisto collegato. */
  readonly cespiti = computed(() => this.tutti().filter(c => c.movimentoAcquistoId != null));

  readonly totaleAnnuo = computed(() =>
    this.cespiti().filter(c => c.isActive).reduce((s, c) => s + c.ammortamentoAnnuo, 0));

  ngOnInit(): void {
    forkJoin({
      cespiti: this.cespitiSvc.getAll(),
      piano:   this.lookup.getPianoConti(),
    }).subscribe({
      next: ({ cespiti, piano }) => {
        this.tutti.set(cespiti);
        this.contiCapex.set(piano.filter(p => /^50\.\d+\.\d+/.test(p.codice))
          .sort((a, b) => a.codice.localeCompare(b.codice)));
        this.loading.set(false);
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading.set(false);
        this.snack.open('Errore nel caricamento del libro cespiti', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  vitaAnni(c: CespiteDTO): number { return Math.round(100 / c.aliquotaAmmortamento); }

  apriAcquisto(): void {
    this.dialog.open(CespiteAcquistoDialogComponent, {
      width: '680px', maxWidth: '95vw',
      data: { contiCapex: this.contiCapex() },
    }).afterClosed().subscribe(ok => { if (ok) this.ricarica(); });
  }

  liquida(c: CespiteDTO): void {
    this.dialog.open(CespiteLiquidazioneDialogComponent, {
      width: '560px', maxWidth: '95vw',
      data: { cespiteId: c.id, descrizione: c.descrizione, costoStorico: c.costoStorico },
    }).afterClosed().subscribe(ok => {
      if (!ok) return;
      this.snack.open('Acquisto liquidato', undefined, { duration: 2500 });
      this.ricarica();
    });
  }

  elimina(c: CespiteDTO): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Elimina cespite',
        message: `Eliminare "${c.descrizione}"? Il movimento di acquisto non ancora pagato verrà annullato.`,
        confirmLabel: 'Elimina', danger: true,
      },
    }).afterClosed().subscribe(ok => {
      if (!ok) return;
      this.cespitiSvc.delete(c.id).subscribe({
        next: () => { this.snack.open('Cespite eliminato', undefined, { duration: 2500 }); this.ricarica(); },
        error: err => this.snack.open(err?.error?.message ?? 'Eliminazione non riuscita', 'OK', { duration: 5000 }),
      });
    });
  }

  private ricarica(): void {
    this.cespitiSvc.getAll().subscribe({
      next: l => { this.tutti.set(l); this.cdr.markForCheck(); },
      error: () => {},
    });
  }
}
