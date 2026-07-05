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
