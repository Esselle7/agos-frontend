import { Component, OnInit, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ImportCountsService } from './import-counts.service';
import { ContatoreImportComponent } from './contatore-import.component';
import { FasiBarComponent } from './fasi-bar.component';

interface NavItem {
  label: string; icon: string; link: string;
}

/**
 * Console "Import & Smistamento": banda KPI fissa + nav laterale con badge-contatori + outlet.
 * Le sezioni (bulk, storico, smistamento/:sezione) sono sotto-rotte linkabili. I contatori
 * vengono dallo {@link ImportCountsService} condiviso, ricaricato dalle sezioni dopo ogni azione.
 */
@Component({
  selector: 'app-import-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule,
            ContatoreImportComponent, FasiBarComponent],
  templateUrl: './import-shell.component.html',
  styleUrls: ['./import-shell.component.scss'],
})
export class ImportShellComponent implements OnInit {
  private readonly counts = inject(ImportCountsService);

  readonly kpi = this.counts.kpi;
  readonly contatore = this.counts.contatore;
  readonly c = this.counts.counts;

  readonly pctImportati = computed(() => {
    const k = this.kpi();
    return k && k.righeTotali ? Math.round((k.importate * 100) / k.righeTotali) : 0;
  });
  /** Tutto ciò che è ancora su un conto transitorio: ora è una coda sola (RiBa incluse). */
  readonly transitoriResidui = computed(() => this.c().catalogare);

  /**
   * Solo gli STRUMENTI. Le code di smistamento — comprese «Duplicati» e «Già a libro», che qui
   * erano le uniche due voci non presenti nella barra di fase — sono passate tutte nella
   * {@link FasiBarComponent} il 13/08/2026: un solo elenco del lavoro, in un posto solo.
   */
  readonly navOps: NavItem[] = [
    { label: 'Importa', icon: 'upload', link: 'bulk' },
    { label: 'Registro', icon: 'receipt_long', link: 'registro' },
    { label: 'Storico', icon: 'history', link: 'storico' },
  ];

  ngOnInit(): void { this.counts.reload(); }
}
