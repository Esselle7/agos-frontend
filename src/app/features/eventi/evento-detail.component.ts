import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, takeUntil } from 'rxjs';
import { EventiService } from '../../core/services/eventi.service';
import { BuService } from '../../core/services/bu.service';
import { AuthService } from '../../core/auth/auth.service';
import {
  EventoDTO,
  EventoPartecipanteDTO,
  StatoEvento,
  TipoPagamentoEvento,
} from '../../core/models/eventi.models';
import { BusinessUnitDTO } from '../../core/models/anagrafica.models';
import { EuroPipe } from '../../shared/pipes/euro.pipe';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { EventoCostiDirettiComponent } from './evento-costi-diretti/evento-costi-diretti.component';
import { EventoVociComponent } from './evento-voci/evento-voci.component';
import { forkJoin } from 'rxjs';

const STATO_COLORS: Record<StatoEvento, string> = {
  PREVENTIVATO: '#FFA500',
  CONFERMATO:   '#2196F3',
  SALDATO:      '#4CAF50',
  ANNULLATO:    '#9E9E9E',
};

/**
 * Mappatura icona/colore per ogni tipo di pagamento. Include RIMBORSO,
 * ripristinato dal backend in V21: i RIMBORSO non sono selezionabili
 * dal form, ma compaiono nello storico pagamenti come importo negativo.
 */
const PAGAMENTO_ICONE: Record<TipoPagamentoEvento, string> = {
  CAPARRA:  'lock',
  ACCONTO:  'savings',
  SALDO:    'done_all',
  PENALE:   'gavel',
  RIMBORSO: 'undo',
};

const PAGAMENTO_COLORS: Record<TipoPagamentoEvento, string> = {
  CAPARRA:  '#f57c00',
  ACCONTO:  '#2C6E8F',
  SALDO:    '#388e3c',
  PENALE:   '#c62828',
  RIMBORSO: '#6d4c41',
};

const STEP_ORDER: StatoEvento[] = ['PREVENTIVATO', 'CONFERMATO', 'SALDATO'];

@Component({
  selector: 'app-evento-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    EuroPipe,
    SkeletonLoaderComponent,
    HelpNoteComponent,
    EventoCostiDirettiComponent,
    EventoVociComponent,
  ],
  templateUrl: './evento-detail.component.html',
  styleUrls: ['./evento-detail.component.scss'],
})
export class EventoDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly eventiService = inject(EventiService);
  private readonly buService = inject(BuService);
  readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroy$ = new Subject<void>();

  // ── Menu (PDF / Word) ──────────────────────────────────────────────────────
  static readonly MENU_MAX_BYTES = 10 * 1024 * 1024;
  static readonly MENU_ACCEPTED_MIMES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ] as const;

  readonly menuPanelOpen  = signal(false);
  readonly menuDragOver   = signal(false);
  readonly menuUploading  = signal(false);

  /**
   * blob: URL del file menu scaricato via HttpClient (autenticato).
   * L'iframe usa questo URL invece di chiamare il backend direttamente,
   * evitando il problema di iframe che non trasportano l'Authorization header.
   */
  private menuBlobUrl: string | null = null;
  private readonly menuPdfBlobSignal = signal<string | null>(null);

  readonly menuPdfSafeUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.menuPdfBlobSignal();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  /** True quando il menu salvato è un documento Word (.doc/.docx). */
  readonly menuIsWord = computed(() => {
    const url = this.evento()?.menuPdfUrl;
    if (!url) return false;
    const ext = url.split('.').pop()?.toLowerCase();
    return ext === 'doc' || ext === 'docx';
  });

  readonly statoColors = STATO_COLORS;
  readonly pagIcone = PAGAMENTO_ICONE;
  readonly pagColors = PAGAMENTO_COLORS;
  readonly stepOrder = STEP_ORDER;

  evento = signal<EventoDTO | null>(null);
  partecipanti = signal<EventoPartecipanteDTO[]>([]);
  buMap = signal<Map<number, BusinessUnitDTO>>(new Map());
  loading = signal(true);
  loadingPartecipanti = signal(false);

  /** Bozza ore inserite per partecipante (chiave = id partecipante). */
  oreDraft = signal<Map<number, number | null>>(new Map());
  /** Id del partecipante per cui è in corso un salvataggio ore. */
  savingOre = signal<number | null>(null);

  /** Partecipanti raggruppati per mansione, ordinati alfabeticamente. */
  readonly partecipantiPerMansione = computed(() => {
    const map = new Map<string, EventoPartecipanteDTO[]>();
    for (const p of this.partecipanti()) {
      const key = p.mansione ?? 'Senza mansione';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'it'))
      .map(([mansione, persone]) => ({ mansione, persone }));
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    forkJoin({
      bu:     this.buService.getAll(),
      evento: this.eventiService.getById(id),
    }).subscribe({
      next: ({ bu, evento }) => {
        this.buMap.set(new Map(bu.map(u => [u.id, u])));
        this.evento.set(evento);
        this.loading.set(false);
        this.cdr.markForCheck();
        this.loadPartecipanti(id);
        if (evento.menuPdfUrl) {
          this.loadMenuPdfBlob(id);
        }
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Errore nel caricamento dell\'evento', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.revokeBlobUrl();
  }

  private loadPartecipanti(eventoId: string): void {
    this.loadingPartecipanti.set(true);
    this.eventiService.getPartecipanti(eventoId).subscribe({
      next: list => {
        this.partecipanti.set(list);
        const draft = new Map<number, number | null>();
        list.forEach(p => draft.set(p.id, p.ore));
        this.oreDraft.set(draft);
        this.loadingPartecipanti.set(false);
        this.cdr.markForCheck();
      },
      error: () => { this.loadingPartecipanti.set(false); this.cdr.markForCheck(); },
    });
  }

  reloadEvento(): void {
    const id = this.evento()!.id;
    this.eventiService.getById(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: ev => { this.evento.set(ev); this.cdr.markForCheck(); },
      error: () => {
        this.snackBar.open('Errore nel ricaricamento dell\'evento', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  openPagamento(): void {
    const ev = this.evento()!;
    const tipiGiaPresenti = ev.pagamenti
      .filter(p => p.stato !== 'ANNULLATO')
      .map(p => p.tipo);

    import('./pagamento-form-dialog.component').then(m => {
      this.dialog.open(m.PagamentoFormDialogComponent, {
        width: '560px',
        maxHeight: '90vh',
        data: {
          eventoId:                    ev.id,
          nomeEvento:                  ev.nome,
          stato:                       ev.stato,
          importoTotalePreviventivato: ev.importoTotalePreviventivato,
          importoResiduo:              ev.importoResiduo,
          tipiGiaPresenti,
        },
      }).afterClosed().subscribe(ok => { if (ok) this.reloadEvento(); });
    }).catch(() => this.snackBar.open('Errore nel caricamento del dialogo', 'OK', { duration: 3000 }));
  }

  openCambioStato(nuovoStato: StatoEvento): void {
    const ev = this.evento()!;
    import('./cambio-stato-dialog.component').then(m => {
      this.dialog.open(m.CambioStatoDialogComponent, {
        width: '480px',
        data: { eventoId: ev.id, statoCorrente: ev.stato, nuovoStato },
      }).afterClosed().subscribe(ok => { if (ok) this.reloadEvento(); });
    }).catch(() => this.snackBar.open('Errore nel caricamento del dialogo', 'OK', { duration: 3000 }));
  }

  openModifica(): void {
    const ev = this.evento()!;
    import('./evento-form-dialog.component').then(m => {
      this.dialog.open(m.EventoFormDialogComponent, {
        width: '700px', maxHeight: '90vh',
        data: { eventoId: ev.id },
      }).afterClosed().subscribe(ok => { if (ok) this.reloadEvento(); });
    }).catch(() => this.snackBar.open('Errore nel caricamento del dialogo', 'OK', { duration: 3000 }));
  }

  deleteEvento(): void {
    const ev = this.evento()!;
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Elimina evento',
        message: `Eliminare l'evento "${ev.nome}"? L'operazione non è reversibile.`,
        confirmLabel: 'Elimina', danger: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.eventiService.delete(ev.id).subscribe({
        next: () => { this.snackBar.open('Evento eliminato', 'OK', { duration: 3000 }); this.router.navigate(['/eventi']); },
        error: () => this.snackBar.open('Errore durante l\'eliminazione', 'OK', { duration: 3000 }),
      });
    });
  }

  removePartecipante(id: number): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Rimuovi partecipante', message: 'Rimuovere questo partecipante dall\'evento?', confirmLabel: 'Rimuovi', danger: true },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.eventiService.deletePartecipante(id).subscribe({
        next: () => { this.partecipanti.update(l => l.filter(p => p.id !== id)); this.cdr.markForCheck(); },
      });
    });
  }

  onCostiUpdated(): void { this.reloadEvento(); }

  // ── Allocazione ore (dipendenti ORARIA) ────────────────────────────────────

  oreVal(id: number): number | null { return this.oreDraft().get(id) ?? null; }

  onOreInput(id: number, ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    const val = raw === '' ? null : Number(raw);
    const m = new Map(this.oreDraft());
    m.set(id, val);
    this.oreDraft.set(m);
  }

  oreTotale(p: EventoPartecipanteDTO): number {
    return (this.oreVal(p.id) ?? 0) * (p.pagaOraria ?? 0);
  }

  allocaOre(p: EventoPartecipanteDTO): void {
    const ore = this.oreVal(p.id);
    if (!ore || ore <= 0) {
      this.snackBar.open('Inserisci le ore da allocare', 'OK', { duration: 3000 });
      return;
    }
    this.savingOre.set(p.id);
    this.eventiService.allocaOrePartecipante(p.id, ore).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.savingOre.set(null);
        this.snackBar.open('Ore allocate, costo registrato', 'OK', { duration: 3000 });
        this.refreshAfterOre();
      },
      error: err => {
        this.savingOre.set(null);
        this.snackBar.open(err?.error?.message ?? 'Errore durante l\'allocazione', 'OK', { duration: 4000 });
        this.cdr.markForCheck();
      },
    });
  }

  rimuoviOre(p: EventoPartecipanteDTO): void {
    this.savingOre.set(p.id);
    this.eventiService.rimuoviOrePartecipante(p.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.savingOre.set(null);
        this.snackBar.open('Allocazione ore rimossa', 'OK', { duration: 3000 });
        this.refreshAfterOre();
      },
      error: () => {
        this.savingOre.set(null);
        this.snackBar.open('Errore durante la rimozione', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  private refreshAfterOre(): void {
    const id = this.evento()!.id;
    this.loadPartecipanti(id);
    this.reloadEvento();
  }

  goBack(): void { this.router.navigate(['/eventi']); }

  // ── Menu PDF ───────────────────────────────────────────────────────────────

  private loadMenuPdfBlob(eventoId: string): void {
    this.eventiService.getMenuPdfBlob(eventoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: blob => {
        this.revokeBlobUrl();
        const url = URL.createObjectURL(blob);
        this.menuBlobUrl = url;
        this.menuPdfBlobSignal.set(url);
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  private revokeBlobUrl(): void {
    if (this.menuBlobUrl) {
      URL.revokeObjectURL(this.menuBlobUrl);
      this.menuBlobUrl = null;
    }
  }

  downloadMenu(): void {
    const url = this.menuBlobUrl;
    if (!url) return;
    const storedUrl = this.evento()?.menuPdfUrl ?? '';
    const ext = storedUrl.split('.').pop() ?? 'pdf';
    const a = document.createElement('a');
    a.href = url;
    a.download = `menu.${ext}`;
    a.click();
  }

  openMenuNewTab(): void {
    const url = this.menuBlobUrl;
    if (!url) return;
    window.open(url, '_blank');
  }

  toggleMenuPanel(): void {
    this.menuPanelOpen.update(v => !v);
  }

  onMenuFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) this.uploadMenu(file);
  }

  onMenuDrop(event: DragEvent): void {
    event.preventDefault();
    this.menuDragOver.set(false);
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) this.uploadMenu(file);
  }

  onMenuDragOver(event: DragEvent): void {
    event.preventDefault();
    this.menuDragOver.set(true);
  }

  onMenuDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.menuDragOver.set(false);
  }

  private uploadMenu(file: File): void {
    if (!EventoDetailComponent.MENU_ACCEPTED_MIMES.includes(file.type as typeof EventoDetailComponent.MENU_ACCEPTED_MIMES[number])) {
      this.snackBar.open('Formato non supportato. Usa PDF o Word (.doc/.docx)', 'OK', { duration: 4000 });
      return;
    }
    if (file.size > EventoDetailComponent.MENU_MAX_BYTES) {
      this.snackBar.open('Il file supera i 10 MB', 'OK', { duration: 3000 });
      return;
    }
    const id = this.evento()!.id;
    this.menuUploading.set(true);
    this.eventiService.uploadMenuPdf(id, file).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ menuPdfUrl }) => {
        this.evento.update(ev => ev ? { ...ev, menuPdfUrl } : ev);
        this.loadMenuPdfBlob(id);
        this.menuUploading.set(false);
        this.menuPanelOpen.set(false);
        this.menuDragOver.set(false);
        this.snackBar.open('Menu aggiornato', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
      error: () => {
        this.menuUploading.set(false);
        this.snackBar.open('Errore durante il caricamento del menu', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  removeMenu(): void {
    const ev = this.evento()!;
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Rimuovi menu',
        message: 'Rimuovere il menu PDF da questo evento?',
        confirmLabel: 'Rimuovi', danger: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.eventiService.deleteMenuPdf(ev.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.revokeBlobUrl();
          this.menuPdfBlobSignal.set(null);
          this.evento.update(e => e ? { ...e, menuPdfUrl: null } : e);
          this.snackBar.open('Menu rimosso', 'OK', { duration: 3000 });
          this.cdr.markForCheck();
        },
        error: () => this.snackBar.open('Errore durante la rimozione', 'OK', { duration: 3000 }),
      });
    });
  }

  // ── Step journey helpers ──────────────────────────────────────────────────
  //
  // Le date di journey (dataConferma/dataSaldo) sono fornite dal backend in
  // EventoDTO e sono visibili anche ai DIPENDENTE: questo permette di
  // renderizzare correttamente lo stepper anche quando la lista pagamenti
  // ha gli importi nascosti per visibility policy.

  stepState(step: StatoEvento): 'done' | 'active' | 'next' {
    const ev = this.evento()!;
    let effectiveStato: StatoEvento = ev.stato;
    if (ev.stato === 'ANNULLATO') {
      // Se l'evento è stato annullato dopo essere stato confermato, mostrare
      // come "done" anche il step CONFERMATO. La presenza di dataConferma è
      // il segnale affidabile (deriva dai movimenti CAPARRA/ACCONTO).
      effectiveStato = ev.dataConferma ? 'CONFERMATO' : 'PREVENTIVATO';
    }
    const curIdx = STEP_ORDER.indexOf(effectiveStato);
    const stepIdx = STEP_ORDER.indexOf(step);
    if (stepIdx < curIdx) return 'done';
    if (stepIdx === curIdx) return 'active';
    return 'next';
  }

  stepLineActive(afterStep: StatoEvento): boolean {
    const nextStep = STEP_ORDER[STEP_ORDER.indexOf(afterStep) + 1] as StatoEvento | undefined;
    if (!nextStep) return false;
    const s = this.stepState(nextStep);
    return s === 'done' || s === 'active';
  }

  stepDateConferma(): string {
    const ev = this.evento();
    if (ev?.dataConferma) return this.formatDate(ev.dataConferma);
    return this.stepState('CONFERMATO') === 'next' ? 'da confermare' : '—';
  }

  stepDateSaldo(): string {
    const ev = this.evento();
    if (ev?.dataSaldo) return this.formatDate(ev.dataSaldo);
    return this.stepState('SALDATO') === 'next' ? 'da registrare' : '—';
  }

  // ── Template helpers ──────────────────────────────────────────────────────

  pagColor(tipo: TipoPagamentoEvento): string { return PAGAMENTO_COLORS[tipo] ?? '#9E9E9E'; }
  pagIcon(tipo: TipoPagamentoEvento):  string { return PAGAMENTO_ICONE[tipo]  ?? 'payments'; }

  statoColor(stato: StatoEvento): string { return STATO_COLORS[stato] ?? '#9E9E9E'; }
  buNome(buId: number): string { return this.buMap().get(buId)?.nome ?? `BU#${buId}`; }
  buColore(buId: number): string { return this.buMap().get(buId)?.colore ?? '#6B7280'; }
  progressColor(pct: number | null): string { return (pct ?? 0) >= 100 ? '#4CAF50' : '#FFA500'; }

  /** Dovuto dal cliente: il consuntivo se presente e >0, altrimenti il preventivo. */
  dovutoCliente(ev: EventoDTO): number {
    const cons = ev.totaleConsuntivato ?? 0;
    return cons > 0 ? cons : (ev.importoTotalePreviventivato ?? 0);
  }
  /** Saldo ancora da incassare rispetto al dovuto (consuntivo o preventivo). */
  saldoDaCorrispondere(ev: EventoDTO): number {
    return this.dovutoCliente(ev) - (ev.importoIncassato ?? 0);
  }
  /** % di una grandezza sulla scala comune delle barre comparative. */
  barPct(value: number | null, ev: EventoDTO): number {
    const scala = Math.max(
      ev.importoTotalePreviventivato ?? 0, this.dovutoCliente(ev), ev.importoIncassato ?? 0, 1);
    return Math.min(100, Math.max(0, ((value ?? 0) / scala) * 100));
  }
  iniziali(nome: string, cognome: string): string { return `${nome.charAt(0)}${cognome.charAt(0)}`.toUpperCase(); }

  formatDate(str: string | null): string {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  formatDatetime(iso: string): string {
    return new Date(iso).toLocaleDateString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
