import { Component, OnInit, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ImportCountsService } from './import-counts.service';

interface NavItem {
  label: string; icon: string; link: string;
  badge?: () => number;
  badgeRosso?: boolean;
  /** Voce nascosta finché la coda è vuota (audit §7.7): la logica resta, sparisce solo il link. */
  soloSePiena?: boolean;
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
  /** Tutto ciò che è ancora su un conto transitorio: ora è una coda sola (RiBa incluse). */
  readonly transitoriResidui = computed(() => this.c().catalogare);

  readonly navOps: NavItem[] = [
    { label: 'Importa', icon: 'upload', link: 'bulk' },
    { label: 'Storico', icon: 'history', link: 'storico' },
  ];
  // "Ricorrenti" è azionabile: la CONFERMA crea il movimento della rata già addebitata in banca.
  // "Incassi evento" pure: RICONCILIA attribuisce l'incasso all'evento e ne registra il pagamento
  // (il ricavo nasce sempre nel modulo Eventi, CLASSIFICA resta bloccata lato server).
  readonly navSmistamento: NavItem[] = [
    { label: 'Spese da sistemare', icon: 'inbox',   link: 'catalogare',             badge: () => this.c().catalogare },
    { label: 'Incassi evento',icon: 'celebration',  link: 'incassi-evento',         badge: () => this.c().eventi },
    { label: 'Rate',          icon: 'event_repeat', link: 'rate',                   badge: () => this.c().ricorrenti },
    // «Già a libro»: la logica NON si tocca (0 DA_LIQUIDARE nel corpus ⇒ misura nulla, non voto
    // basso). Si nasconde solo la voce finché la coda è vuota — scelta di UI, reversibile.
    { label: 'Già a libro',   icon: 'join_inner',   link: 'smistamento/matching-differiti',
      badge: () => this.c().matchingDifferiti, soloSePiena: true },
    { label: 'Duplicati',     icon: 'content_copy', link: 'smistamento/duplicati',  badge: () => this.c().duplicati },
    // Badge ROSSO, non grigio: è l'unica coda che rappresenta denaro FUORI dai conti (audit §7.4
    // regola 2). Le altre code sono lavoro d'ufficio; questa sono accrediti bancari non registrati.
    { label: 'Righe fuori dai conti', icon: 'money_off', link: 'scartati',
      badge: () => this.c().scartati, badgeRosso: true },
    // «Effetti / RiBa» e «Business Unit» non sono più voci: le prime sono uscite da catalogare
    // come le altre (audit §7.7), il ramo è il secondo mezzo-passo del wizard (§7.5). La vista
    // per-ramo era reportistica: l'endpoint resta, la pagina si ricostruisce sotto Report.
  ];

  /** La nav mostra solo le code che hanno lavoro dentro (o che si aprono comunque a mano). */
  readonly vociVisibili = computed(() =>
    this.navSmistamento.filter(n => !n.soloSePiena || (n.badge?.() ?? 0) > 0));

  ngOnInit(): void { this.counts.reload(); }
}
