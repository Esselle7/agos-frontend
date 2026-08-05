import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SpeseRicorrentiService } from '../../core/services/spese-ricorrenti.service';
import { PlanDetailDTO, InstallmentDTO } from './spese-ricorrenti.models';
import { EuroPipe } from '../../shared/pipes/euro.pipe';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';

@Component({
  selector: 'app-spese-ricorrenti-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatChipsModule,
    MatTooltipModule, MatDialogModule, MatMenuModule, MatDividerModule,
    MatFormFieldModule, MatInputModule,
    DatePipe, EuroPipe, HelpNoteComponent,
  ],
  templateUrl: './spese-ricorrenti-detail.component.html',
  styleUrls: ['./spese-ricorrenti-detail.component.scss'],
})
export class SpeseRicorrentiDetailComponent implements OnInit {
  private readonly service = inject(SpeseRicorrentiService);
  private readonly route   = inject(ActivatedRoute);
  private readonly router  = inject(Router);
  private readonly dialog  = inject(MatDialog);

  readonly plan    = signal<PlanDetailDTO | null>(null);
  readonly loading = signal(true);
  readonly error   = signal<string | null>(null);
  readonly working = signal(false);

  // inline edit state
  editingRataId = signal<string | null>(null);
  editImporto   = 0;
  editData      = '';
  editNote      = '';

  // liquidate / cancel dialogs
  liquidateNote     = '';
  liquidateImporto: number | null = null;
  liquidateError    = signal<string | null>(null);
  showLiquidate     = signal(false);

  cancelNote    = '';
  cancelPenale  = 0;
  showCancel    = signal(false);

  showDelete    = signal(false);
  deleteError   = signal<string | null>(null);

  showPurge     = signal(false);
  purgeError    = signal<string | null>(null);

  private planId!: string;

  ngOnInit(): void {
    this.planId = this.route.snapshot.paramMap.get('id')!;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.getPlan(this.planId).subscribe({
      next: data => { this.plan.set(data); this.loading.set(false); },
      error: ()   => { this.error.set('Errore caricamento piano'); this.loading.set(false); },
    });
  }

  back(): void { this.router.navigate(['/spese-ricorrenti']); }

  // ── Inline edit ──────────────────────────────────────────────────────────

  startEdit(rata: InstallmentDTO): void {
    this.editingRataId.set(rata.id);
    this.editImporto = rata.importo;
    this.editData    = rata.dataScadenza;
    this.editNote    = rata.note ?? '';
  }

  cancelEdit(): void { this.editingRataId.set(null); }

  saveEdit(rata: InstallmentDTO): void {
    this.working.set(true);
    this.service.updateInstallment(
      this.planId, rata.id,
      this.editImporto, this.editData, this.editNote
    ).subscribe({
      next: () => { this.editingRataId.set(null); this.load(); },
      error: () => this.working.set(false),
    });
  }

  // ── Pay single installment ───────────────────────────────────────────────

  payInstallment(rata: InstallmentDTO): void {
    this.working.set(true);
    this.service.payInstallment(this.planId, rata.id).subscribe({
      next: data => { this.plan.set(data); this.working.set(false); },
      error: () => this.working.set(false),
    });
  }

  // ── Skip ─────────────────────────────────────────────────────────────────

  skip(rata: InstallmentDTO, modalita: 'RIMANDA' | 'ACCORPA'): void {
    this.working.set(true);
    this.service.skipInstallment(this.planId, rata.id, modalita).subscribe({
      next: () => this.load(),
      error: () => this.working.set(false),
    });
  }

  // ── Liquidate ─────────────────────────────────────────────────────────────

  openLiquidate(): void {
    this.liquidateImporto = null;
    this.liquidateNote    = '';
    this.liquidateError.set(null);
    this.showLiquidate.set(true);
  }

  confirmLiquidate(): void {
    this.working.set(true);
    this.liquidateError.set(null);
    this.service.liquidatePlan(
      this.planId,
      this.liquidateImporto ?? undefined,
      this.liquidateNote
    ).subscribe({
      next: data => { this.plan.set(data); this.showLiquidate.set(false); this.working.set(false); },
      error: (err) => {
        const msg = err?.error?.message ?? 'Errore durante la liquidazione';
        this.liquidateError.set(msg);
        this.working.set(false);
      },
    });
  }

  // ── Cancel ───────────────────────────────────────────────────────────────

  confirmCancel(): void {
    this.working.set(true);
    this.service.cancelPlan(this.planId, this.cancelPenale, this.cancelNote).subscribe({
      next: () => { this.showCancel.set(false); this.load(); },
      error: () => this.working.set(false),
    });
  }

  // ── Delete (eliminazione fisica) ──────────────────────────────────────────

  openDelete(): void {
    this.deleteError.set(null);
    this.showDelete.set(true);
  }

  confirmDelete(): void {
    this.working.set(true);
    this.deleteError.set(null);
    this.service.deletePlan(this.planId).subscribe({
      next: () => this.router.navigate(['/spese-ricorrenti']),
      error: err => {
        this.deleteError.set(err?.error?.message ?? 'Errore durante l\'eliminazione');
        this.working.set(false);
      },
    });
  }

  // ── Cestina (purga fisica totale di un piano ANNULLATO) ───────────────────

  openPurge(): void {
    this.purgeError.set(null);
    this.showPurge.set(true);
  }

  confirmPurge(): void {
    this.working.set(true);
    this.purgeError.set(null);
    this.service.purgePlan(this.planId).subscribe({
      next: () => this.router.navigate(['/spese-ricorrenti']),
      error: err => {
        this.purgeError.set(err?.error?.message ?? 'Errore durante la cestina');
        this.working.set(false);
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  isActive(): boolean { return this.plan()?.stato === 'ATTIVO'; }

  /** Eliminabile solo se ATTIVO e nessuna rata pagata (= nessun movimento contabile); il server ri-verifica. */
  canDelete(): boolean {
    const p = this.plan();
    return p?.stato === 'ATTIVO' && p.rate.every(r => r.stato !== 'PAID');
  }

  /** Cestinabile solo se ANNULLATO; il server ri-verifica (409 PIANO_NON_ANNULLATO). */
  canPurge(): boolean {
    return this.plan()?.stato === 'ANNULLATO';
  }

  isPast(rata: InstallmentDTO): boolean {
    return rata.stato === 'PAID' || rata.stato === 'CANCELLED';
  }

  canEdit(rata: InstallmentDTO): boolean {
    return rata.stato === 'PENDING' && this.isActive();
  }

  statoClass(stato: string): string {
    return {
      PENDING:   'badge--orange',
      PAID:      'badge--green',
      CANCELLED: 'badge--red',
      SKIPPED:   'badge--gray',
    }[stato] ?? '';
  }

  /**
   * Rata scaduta e ancora non confermata dalla banca. Dal 2026-08-05 nessun job la "paga" da solo
   * alla scadenza: resta PENDING finché non arriva l'addebito (COLLEGA dall'import) o non la paghi
   * a mano. Senza questo segnale il cambio di comportamento sarebbe invisibile all'utente.
   */
  inAttesaDiAddebito(rata: InstallmentDTO): boolean {
    return rata.stato === 'PENDING' && rata.dataScadenza < this.oggiIso;
  }
  private readonly oggiIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  planStatoClass(stato: string): string {
    return { ATTIVO: 'badge--green', COMPLETATO: 'badge--blue', ANNULLATO: 'badge--red' }[stato] ?? '';
  }

  progressPct(): number {
    const p = this.plan();
    if (!p || p.numeroRate === 0) return 0;
    return Math.round((p.rate.filter(r => r.stato === 'PAID').length / p.numeroRate) * 100);
  }

  frequenzaLabel(f: string): string {
    return { MENSILE: 'Mensile', BIMESTRALE: 'Bimestrale', TRIMESTRALE: 'Trimestrale', ANNUALE: 'Annuale' }[f] ?? f;
  }

  totaleResiduo(): number {
    return this.plan()?.rate
      .filter(r => r.stato === 'PENDING')
      .reduce((s, r) => s + r.importo, 0) ?? 0;
  }

  saldoCoveragePct(saldo: number, residuo: number): number {
    if (residuo <= 0) return 100;
    if (saldo <= 0)   return 0;
    return Math.min(100, Math.round((saldo / residuo) * 100));
  }
}
