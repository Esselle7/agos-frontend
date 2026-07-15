import { Component, OnInit, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ImportCountsService } from './import-counts.service';

interface NavItem { label: string; icon: string; link: string; badge?: () => number; }

/**
 * Console "Import & Smistamento": banda KPI fissa + nav laterale con badge-contatori + outlet.
 * Le sezioni (bulk, storico, smistamento/:sezione) sono sotto-rotte linkabili. I contatori
 * vengono dallo {@link ImportCountsService} condiviso, ricaricato dalle sezioni dopo ogni azione.
 */
@Component({
  selector: 'app-import-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule],
  templateUrl: './import-shell.component.html',
  styleUrls: ['./import-shell.component.scss'],
})
export class ImportShellComponent implements OnInit {
  private readonly counts = inject(ImportCountsService);

  readonly kpi = this.counts.kpi;
  readonly c = this.counts.counts;

  readonly pctImportati = computed(() => {
    const k = this.kpi();
    return k && k.righeTotali ? Math.round((k.importate * 100) / k.righeTotali) : 0;
  });
  readonly transitoriResidui = computed(() => {
    const c = this.c();
    return c.catalogare + c.riba; // tutto ciò che è ancora su transitorio
  });

  readonly navOps: NavItem[] = [
    { label: 'Importa', icon: 'upload', link: 'bulk' },
    { label: 'Storico', icon: 'history', link: 'storico' },
  ];
  // "Ricorrenti" è azionabile: la CONFERMA crea il movimento della rata già addebitata in banca.
  // "Eventi" resta nascosta (i ricavi evento nascono dal modulo Eventi; CLASSIFICA è bloccata a BE).
  readonly navSmistamento: NavItem[] = [
    { label: 'Da catalogare', icon: 'inbox',        link: 'smistamento/catalogare', badge: () => this.c().catalogare },
    { label: 'Quadratura POS',icon: 'balance',      link: 'quadratura' },
    { label: 'Ricorrenti',    icon: 'event_repeat', link: 'smistamento/ricorrenti', badge: () => this.c().ricorrenti },
    { label: 'Effetti / RiBa',icon: 'receipt_long', link: 'smistamento/riba',       badge: () => this.c().riba },
    { label: 'Già a libro',   icon: 'join_inner',   link: 'smistamento/matching-differiti', badge: () => this.c().matchingDifferiti },
    { label: 'Duplicati',     icon: 'content_copy', link: 'smistamento/duplicati',  badge: () => this.c().duplicati },
  ];

  ngOnInit(): void { this.counts.reload(); }
}
