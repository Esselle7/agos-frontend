import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { SpeseRicorrentiService } from '../../core/services/spese-ricorrenti.service';
import { PlanSummaryDTO } from './spese-ricorrenti.models';
import { SpeseRicorrentiCreateDialogComponent } from './spese-ricorrenti-create-dialog.component';
import { EuroPipe } from '../../shared/pipes/euro.pipe';

@Component({
  selector: 'app-spese-ricorrenti-list',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatChipsModule,
    MatProgressSpinnerModule, MatTooltipModule, MatDialogModule,
    EuroPipe,
  ],
  templateUrl: './spese-ricorrenti-list.component.html',
  styleUrls: ['./spese-ricorrenti-list.component.scss'],
})
export class SpeseRicorrentiListComponent implements OnInit {
  private readonly service = inject(SpeseRicorrentiService);
  private readonly router  = inject(Router);
  private readonly dialog  = inject(MatDialog);

  readonly plans  = signal<PlanSummaryDTO[]>([]);
  readonly loading = signal(true);
  readonly error   = signal<string | null>(null);

  readonly deleteTarget = signal<PlanSummaryDTO | null>(null);
  readonly deleteError  = signal<string | null>(null);
  readonly deleting     = signal(false);

  readonly purgeTarget  = signal<PlanSummaryDTO | null>(null);
  readonly purgeError   = signal<string | null>(null);
  readonly purging      = signal(false);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.listPlans().subscribe({
      next: data => { this.plans.set(data); this.loading.set(false); },
      error: ()   => { this.error.set('Errore caricamento piani'); this.loading.set(false); },
    });
  }

  openCreate(): void {
    const ref = this.dialog.open(SpeseRicorrentiCreateDialogComponent, {
      width: '820px', maxWidth: '96vw', disableClose: true,
    });
    ref.afterClosed().subscribe(created => { if (created) this.load(); });
  }

  goToDetail(id: string): void {
    this.router.navigate(['/spese-ricorrenti', id]);
  }

  // ── Delete (eliminazione fisica) ──────────────────────────────────────────

  /** Eliminabile solo se ATTIVO e nessuna rata pagata (= nessun movimento contabile); il server ri-verifica. */
  canDelete(plan: PlanSummaryDTO): boolean {
    return plan.stato === 'ATTIVO' && plan.ratePaid === 0;
  }

  askDelete(plan: PlanSummaryDTO, ev: Event): void {
    ev.stopPropagation(); // la card naviga al dettaglio
    this.deleteError.set(null);
    this.deleteTarget.set(plan);
  }

  confirmDelete(): void {
    const plan = this.deleteTarget();
    if (!plan) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.service.deletePlan(plan.id).subscribe({
      next: () => { this.deleteTarget.set(null); this.deleting.set(false); this.load(); },
      error: err => {
        this.deleteError.set(err?.error?.message ?? 'Errore durante l\'eliminazione');
        this.deleting.set(false);
      },
    });
  }

  // ── Cestina (purga fisica totale di un piano ANNULLATO) ───────────────────

  /** Cestinabile solo se ANNULLATO; il server ri-verifica (409 PIANO_NON_ANNULLATO). */
  canPurge(plan: PlanSummaryDTO): boolean {
    return plan.stato === 'ANNULLATO';
  }

  askPurge(plan: PlanSummaryDTO, ev: Event): void {
    ev.stopPropagation(); // la card naviga al dettaglio
    this.purgeError.set(null);
    this.purgeTarget.set(plan);
  }

  confirmPurge(): void {
    const plan = this.purgeTarget();
    if (!plan) return;
    this.purging.set(true);
    this.purgeError.set(null);
    this.service.purgePlan(plan.id).subscribe({
      next: () => { this.purgeTarget.set(null); this.purging.set(false); this.load(); },
      error: err => {
        this.purgeError.set(err?.error?.message ?? 'Errore durante la cestina');
        this.purging.set(false);
      },
    });
  }

  statoClass(stato: string): string {
    return { ATTIVO: 'badge--green', COMPLETATO: 'badge--blue', ANNULLATO: 'badge--red' }[stato] ?? '';
  }

  frequenzaLabel(f: string): string {
    return { MENSILE: 'Mensile', BIMESTRALE: 'Bimestrale', TRIMESTRALE: 'Trimestrale', ANNUALE: 'Annuale' }[f] ?? f;
  }

  progressPct(plan: PlanSummaryDTO): number {
    if (plan.numeroRate === 0) return 0;
    return Math.round((plan.ratePaid / plan.numeroRate) * 100);
  }
}
