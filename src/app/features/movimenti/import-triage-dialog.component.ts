import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';

import { MovimentiService } from '../../core/services/movimenti.service';
import { LookupService } from '../../core/services/lookup.service';
import { FornitoriService } from '../../core/services/fornitori.service';
import { BuService } from '../../core/services/bu.service';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';
import {
  ImportKpiDTO,
  TransitorioDTO,
  EventoParcheggiatoDTO,
  ClassificaTransitorioRequest,
  RisolviEventoRequest,
  CoppiaSospettaDTO,
  EventoBreveDTO,
  MotivoMatchDTO,
  RicorrenteParcheggiataDTO,
  MatchingDifferitoDTO,
} from '../../core/models/movimenti.models';
import { ImportCountsService } from '../import/import-counts.service';
import {
  PianoContiCogeDTO,
  FornitoreSummaryDTO,
  BusinessUnitDTO,
} from '../../core/models/anagrafica.models';

interface TransForm {
  cogeId: FormControl<number | null>;
  businessUnitId: FormControl<number | null>;
  fornitoreId: FormControl<string | null>;
  apprendiKeyword: FormControl<boolean>;
  nota: FormControl<string | null>;
}

interface EventoForm {
  cogeId: FormControl<number | null>;
  businessUnitId: FormControl<number | null>;
  nota: FormControl<string | null>;
}

/**
 * Centro di smistamento import: catalogazione dei movimenti finiti sui conti
 * transitori (39.99.999 / 49.99.999) e gestione degli eventi parcheggiati.
 * Ogni azione aggiorna i contatori KPI in tempo reale.
 */
@Component({
  selector: 'app-import-triage-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatSlideToggleModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    CogePickerComponent,
  ],
  templateUrl: './import-triage-dialog.component.html',
  styleUrls: ['./import-triage-dialog.component.scss'],
})
export class ImportTriageDialogComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly counts = inject(ImportCountsService);
  private readonly movimentiService = inject(MovimentiService);
  private readonly lookupService = inject(LookupService);
  private readonly fornitoriService = inject(FornitoriService);
  private readonly buService = inject(BuService);
  private readonly snackBar = inject(MatSnackBar);

  /** Sezione attiva (da rotta :sezione) → indice del tab (header nascosti, guida la nav laterale). */
  sezione = signal<string>('catalogare');
  private readonly tabIndex: Record<string, number> = {
    catalogare: 0, eventi: 1, duplicati: 2, ricorrenti: 3, riba: 4, 'matching-differiti': 5,
  };
  selectedIndex = computed(() => this.tabIndex[this.sezione()] ?? 0);

  loading = signal(true);
  saving = signal<string | null>(null);
  modificato = false;

  kpi = signal<ImportKpiDTO | null>(null);
  transitori = signal<TransitorioDTO[]>([]);
  eventi = signal<EventoParcheggiatoDTO[]>([]);
  coppie = signal<CoppiaSospettaDTO[]>([]);
  ricorrenti = signal<RicorrenteParcheggiataDTO[]>([]);
  riba = signal<TransitorioDTO[]>([]);
  matchingDiff = signal<MatchingDifferitoDTO[]>([]);

  /** CoGe scelto per ogni ricorrente USCITA (id ricorrente → id coge), seedato dal suggerito. */
  cogeSelRic = signal<Record<string, number | null>>({});

  /** Circonferenza del ring punteggio (r=20). */
  readonly ringCirc = 2 * Math.PI * 20;

  coge = signal<PianoContiCogeDTO[]>([]);
  bu = signal<BusinessUnitDTO[]>([]);
  fornitori = signal<FornitoreSummaryDTO[]>([]);

  // Anteprima keyword: "queste keyword imparerò da questa riga" (caricata all'apertura del pannello).
  anteprime = signal<Record<string, { token: string[]; natura: string }[]>>({});

  private readonly transForms = new Map<string, FormGroup<TransForm>>();
  private readonly eventoForms = new Map<string, FormGroup<EventoForm>>();

  /** Sezioni già caricate (lazy): si carica solo la sezione attiva, non tutte e 6. */
  private readonly caricate = new Set<string>();
  /** Sezione attualmente in caricamento (per mostrare lo spinner, non un falso "vuoto"). */
  sezioneLoading = signal<string | null>(null);

  ngOnInit(): void {
    // 1) Lookups UNA volta sola (coge/bu/fornitori: cambiano di rado).
    forkJoin({
      coge: this.lookupService.getPianoConti(),
      bu: this.buService.getAll(),
      fornitori: this.fornitoriService.getList({ size: 300 }),
    }).subscribe({
      next: ({ coge, bu, fornitori }) => {
        this.coge.set(coge); this.bu.set(bu); this.fornitori.set(fornitori.content);
        this.loading.set(false);
        this.caricaSezione(this.sezione());
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Errore nel caricamento dello smistamento import', 'OK', { duration: 4000 });
      },
    });
    // 2) La sezione attiva (e i suoi dati) seguono la rotta, in modo lazy.
    this.route.paramMap.subscribe(p => {
      const s = p.get('sezione') ?? 'catalogare';
      // "Eventi" resta nascosta (code informative, niente movimenti): deep-link → "Da catalogare".
      // "Ricorrenti" è di nuovo azionabile (la CONFERMA crea il movimento).
      if (s === 'eventi') {
        this.router.navigate(['/import/smistamento/catalogare']);
        return;
      }
      this.sezione.set(s);
      if (!this.loading()) this.caricaSezione(s);
    });
  }

  /** Carica i dati della SOLA sezione richiesta, una volta (lazy load → niente over-fetch). */
  private caricaSezione(s: string): void {
    if (this.caricate.has(s)) return;
    this.caricate.add(s);
    this.sezioneLoading.set(s);
    const done = () => { if (this.sezioneLoading() === s) this.sezioneLoading.set(null); };
    const fail = (e: unknown) => { this.caricate.delete(s); done(); this.fail(e as { error?: { message?: string } }); };
    switch (s) {
      case 'catalogare':
        // ponytail: cap a 200 (era 2000). Il backend riestrae IBAN/controparte con regex
        // per riga: 200 righe ~80ms vs 780ms su 600. Le righe escono man mano che le smisti.
        // Se servono >200 visibili insieme, persisti la controparte all'import (no regex al read).
        this.movimentiService.getTransitori(undefined, 0, 200).subscribe({
          next: r => { r.content.forEach(t => this.transForms.set(t.id, this.buildTransForm())); this.transitori.set(r.content); done(); }, error: fail });
        break;
      case 'riba':
        this.movimentiService.getRibaTransitori(0, 2000).subscribe({
          next: r => { r.content.forEach(t => this.transForms.set(t.id, this.buildTransForm())); this.riba.set(r.content); done(); }, error: fail });
        break;
      case 'ricorrenti':
        this.movimentiService.getRicorrenti('DA_RICONCILIARE', 0, 2000).subscribe({
          next: r => {
            // Seed della select CoGe dal suggerimento backend (l'utente conferma o cambia).
            const sel: Record<string, number | null> = {};
            r.content.forEach(x => { sel[x.id] = x.cogeSuggeritoId; });
            this.cogeSelRic.set(sel);
            this.ricorrenti.set(r.content); done();
          }, error: fail });
        break;
      case 'eventi':
        this.movimentiService.getEventiParcheggiati('DA_RICONCILIARE', 0, 2000).subscribe({
          next: r => { r.content.forEach(e => this.eventoForms.set(e.id, this.buildEventoForm())); this.eventi.set(r.content); done(); }, error: fail });
        break;
      case 'duplicati':
        this.movimentiService.getAnalisiDuplicati().subscribe({ next: a => { this.coppie.set(a.coppie); this.counts.setDuplicati(a.coppie.length); done(); }, error: fail });
        break;
      case 'matching-differiti':
        this.movimentiService.getMatchingDifferiti('DA_RICONCILIARE', 0, 2000).subscribe({ next: r => { this.matchingDiff.set(r.content); done(); }, error: fail });
        break;
      default: done();
    }
  }

  /** Dopo un'azione: ricarica i badge dello shell (il KPI lo possiede lo shell). */
  private refreshKpi(): void {
    this.counts.reload();
  }

  // ── Transitori ──────────────────────────────────────────────────────────────
  transFormFor(id: string): FormGroup<TransForm> { return this.transForms.get(id)!; }

  /** Scelta COGE dal picker per le righe transitorio/RiBa (id nel control, come il vecchio select). */
  setCogeTrans(id: string, conto: PianoContiCogeDTO | null): void {
    const c = this.transForms.get(id)!.controls.cogeId;
    c.setValue(conto?.id ?? null);
    c.markAsTouched();
  }

  /** Scelta COGE (opzionale) per la registrazione di un evento. */
  setCogeEvento(id: string, conto: PianoContiCogeDTO | null): void {
    this.eventoForms.get(id)!.controls.cogeId.setValue(conto?.id ?? null);
  }

  canClassificareTrans(id: string): boolean {
    const f = this.transForms.get(id);
    return !!f && f.controls.cogeId.value != null && f.controls.businessUnitId.value != null;
  }

  pct(s: number): number { return Math.round(s * 100); }

  anteprimaFor(id: string): { token: string[]; natura: string }[] { return this.anteprime()[id] ?? []; }

  /** Carica l'anteprima delle keyword che verrebbero apprese dalla descrizione di questa riga. */
  caricaAnteprima(t: TransitorioDTO): void {
    if (this.anteprime()[t.id] !== undefined) return;
    const sorgente = t.contoBancarioId === 1 ? 'BPM' : t.contoBancarioId === 2 ? 'CA' : undefined;
    this.movimentiService.anteprimaKeyword(t.descrizione, sorgente).subscribe({
      next: a => this.anteprime.update(m => ({ ...m, [t.id]: a.firme })),
      error: () => this.anteprime.update(m => ({ ...m, [t.id]: [] })),
    });
  }

  classificaTrans(t: TransitorioDTO): void {
    const f = this.transForms.get(t.id)!;
    const req: ClassificaTransitorioRequest = {
      cogeId: f.controls.cogeId.value!,
      businessUnitId: f.controls.businessUnitId.value!,
      fornitoreId: f.controls.fornitoreId.value,
      apprendiKeyword: f.controls.apprendiKeyword.value,
      nota: f.controls.nota.value,
    };
    this.saving.set(t.id);
    this.movimentiService.classificaTransitorio(t.id, req).subscribe({
      next: () => {
        this.saving.set(null);
        this.transitori.update(rs => rs.filter(r => r.id !== t.id));
        this.transForms.delete(t.id);
        this.modificato = true;
        this.refreshKpi();
        this.snackBar.open('Movimento catalogato' + (req.apprendiKeyword ? ' e keyword apprese' : ''), 'OK', { duration: 2500 });
      },
      error: err => this.fail(err),
    });
  }

  // ── Spese ricorrenti parcheggiate (V9 + V22) ─────────────────────────────────
  setCogeRic(ricorrenteId: string, cogeId: number | null): void {
    this.cogeSelRic.update(m => ({ ...m, [ricorrenteId]: cogeId }));
  }

  /** Su USCITA serve un CoGe scelto; su ENTRATA il backend forza 90.01.001. */
  canConfermareRic(r: RicorrenteParcheggiataDTO): boolean {
    return r.tipo === 'ENTRATA' || this.cogeSelRic()[r.id] != null;
  }

  confermaRicorrente(r: RicorrenteParcheggiataDTO): void {
    const cogeId = r.tipo === 'ENTRATA' ? null : this.cogeSelRic()[r.id] ?? null;
    if (r.tipo === 'USCITA' && cogeId == null) {
      this.snackBar.open('Seleziona il conto CoGe della rata', 'OK', { duration: 2500 }); return;
    }
    this.saving.set(r.id);
    this.movimentiService.risolviRicorrente(r.id, { azione: 'CONFERMA', cogeId, nota: null }).subscribe({
      next: () => { this.saving.set(null); this.ricorrenti.update(rs => rs.filter(x => x.id !== r.id)); this.modificato = true;
        this.counts.reload();
        this.snackBar.open('Movimento creato dalla ricorrente', 'OK', { duration: 2500 }); },
      error: err => this.fail(err),
    });
  }

  ignoraRicorrente(r: RicorrenteParcheggiataDTO): void {
    this.saving.set(r.id);
    this.movimentiService.risolviRicorrente(r.id, { azione: 'IGNORA', cogeId: null, nota: null }).subscribe({
      next: () => { this.saving.set(null); this.ricorrenti.update(rs => rs.filter(x => x.id !== r.id)); this.modificato = true;
        this.counts.reload();
        this.snackBar.open('Ricorrente ignorata', 'OK', { duration: 2000 }); },
      error: err => this.fail(err),
    });
  }

  // ── Effetti / RiBa (transitori filtrati) ─────────────────────────────────────
  classificaRiba(t: TransitorioDTO): void {
    const f = this.transForms.get(t.id)!;
    const req: ClassificaTransitorioRequest = {
      cogeId: f.controls.cogeId.value!,
      businessUnitId: f.controls.businessUnitId.value!,
      fornitoreId: f.controls.fornitoreId.value,
      // MAI imparare keyword dalle RiBa: la descrizione ("EFFETTI RITIRATI") è generica e
      // creerebbe una firma spuria che dirotterebbe tutte le RiBa future su un solo fornitore.
      apprendiKeyword: false,
      nota: f.controls.nota.value,
    };
    this.saving.set(t.id);
    this.movimentiService.classificaTransitorio(t.id, req).subscribe({
      next: () => { this.saving.set(null); this.riba.update(rs => rs.filter(x => x.id !== t.id)); this.transForms.delete(t.id);
        this.modificato = true; this.refreshKpi();
        this.snackBar.open('Effetto/RiBa catalogato', 'OK', { duration: 2500 }); },
      error: err => this.fail(err),
    });
  }

  // ── Eventi ──────────────────────────────────────────────────────────────────
  eventoFormFor(id: string): FormGroup<EventoForm> { return this.eventoForms.get(id)!; }

  canClassificareEvento(id: string): boolean {
    const f = this.eventoForms.get(id);
    return !!f && f.controls.cogeId.value != null && f.controls.businessUnitId.value != null;
  }

  scartaEvento(ev: EventoParcheggiatoDTO): void {
    this.risolvi(ev, { azione: 'SCARTA', cogeId: null, businessUnitId: null, eventoId: null, nota: this.eventoFormFor(ev.id).controls.nota.value }, 'Evento scartato');
  }

  riconciliaEvento(ev: EventoParcheggiatoDTO): void {
    this.risolvi(ev, { azione: 'RICONCILIA', cogeId: null, businessUnitId: null, eventoId: null, nota: this.eventoFormFor(ev.id).controls.nota.value }, 'Evento segnato come riconciliato');
  }

  classificaEvento(ev: EventoParcheggiatoDTO): void {
    const f = this.eventoFormFor(ev.id);
    this.risolvi(ev, { azione: 'CLASSIFICA', cogeId: f.controls.cogeId.value, businessUnitId: f.controls.businessUnitId.value, eventoId: null, nota: f.controls.nota.value }, 'Evento registrato come movimento');
  }

  private risolvi(ev: EventoParcheggiatoDTO, req: RisolviEventoRequest, okMsg: string): void {
    this.saving.set(ev.id);
    this.movimentiService.risolviEvento(ev.id, req).subscribe({
      next: () => {
        this.saving.set(null);
        this.eventi.update(rs => rs.filter(r => r.id !== ev.id));
        this.eventoForms.delete(ev.id);
        this.modificato = true;
        this.refreshKpi();
        this.snackBar.open(okMsg, 'OK', { duration: 2500 });
      },
      error: err => this.fail(err),
    });
  }

  // ── Matching differiti (Feature 2): import banche ↔ movimenti Da Liquidare ────

  /** COLLEGA: la riga banca È il movimento Da Liquidare già a libro → lo liquida (niente doppione). */
  collegaMatching(m: MatchingDifferitoDTO): void {
    this.saving.set(m.id);
    this.movimentiService.risolviMatchingDifferito(m.id, { azione: 'COLLEGA', metodoPagamentoId: null, nota: null }).subscribe({
      next: () => {
        this.saving.set(null);
        this.matchingDiff.update(rs => rs.filter(x => x.id !== m.id));
        this.modificato = true;
        this.refreshKpi();
        this.snackBar.open('Movimento esistente liquidato (nessun doppione creato)', 'OK', { duration: 3000 });
      },
      error: err => this.fail(err),
    });
  }

  /** IGNORA: falso positivo → la riga banca diventa un nuovo movimento; l'originale resta aperto. */
  ignoraMatching(m: MatchingDifferitoDTO): void {
    this.saving.set(m.id);
    this.movimentiService.risolviMatchingDifferito(m.id, { azione: 'IGNORA', metodoPagamentoId: null, nota: null }).subscribe({
      next: () => {
        this.saving.set(null);
        this.matchingDiff.update(rs => rs.filter(x => x.id !== m.id));
        this.modificato = true;
        this.refreshKpi();
        this.snackBar.open('Riga importata come nuovo movimento separato', 'OK', { duration: 3000 });
      },
      error: err => this.fail(err),
    });
  }

  private fail(err: { error?: { message?: string } }): void {
    this.saving.set(null);
    this.snackBar.open(err.error?.message ?? 'Operazione non riuscita', 'OK', { duration: 4000 });
  }

  // ── Possibili duplicati ─────────────────────────────────────────────────────

  /** Offset del ring SVG in funzione del punteggio 0-100. */
  ringOffset(punteggio: number): number {
    return this.ringCirc * (1 - Math.max(0, Math.min(100, punteggio)) / 100);
  }

  confLabel(c: CoppiaSospettaDTO): string {
    return c.confidenza === 'CERTA' ? 'Confidenza certa' : 'Da verificare';
  }

  fonteLabel(fonte: string): string {
    return fonte === 'IMPORT_BILLY' ? 'Billy · Cassa' : 'Banca · Estratto conto';
  }

  fonteClass(fonte: string): string {
    return 'triage__dup-src ' + (fonte === 'IMPORT_BILLY' ? 'billy' : 'banca');
  }

  /** Titolo della coppia: il nominativo più informativo tra i due lati. */
  titoloCoppia(c: CoppiaSospettaDTO): string {
    const nomi = [c.eventoA.controparteNome, c.eventoB.controparteNome]
      .filter((n): n is string => !!n)
      .sort((a, b) => b.length - a.length);
    return nomi[0] ?? 'Intestatario non indicato';
  }

  motivoClass(m: MotivoMatchDTO): string {
    return 'triage__dup-reason ' + m.tono.toLowerCase();
  }

  /** Scarta uno dei due eventi come duplicato (riusa la risoluzione evento). */
  scartaDuplicato(ev: EventoBreveDTO): void {
    this.saving.set(ev.id);
    this.movimentiService.risolviEvento(ev.id, {
      azione: 'SCARTA', cogeId: null, businessUnitId: null, eventoId: null,
      nota: 'Duplicato cross-sorgente',
    }).subscribe({
      next: () => {
        this.saving.set(null);
        this.coppie.update(cs => cs.filter(c => c.eventoA.id !== ev.id && c.eventoB.id !== ev.id));
        this.eventi.update(rs => rs.filter(r => r.id !== ev.id));
        this.eventoForms.delete(ev.id);
        this.modificato = true;
        this.refreshKpi();
        this.snackBar.open('Evento scartato come duplicato', 'OK', { duration: 2500 });
      },
      error: err => this.fail(err),
    });
  }


  private buildTransForm(): FormGroup<TransForm> {
    return new FormGroup<TransForm>({
      cogeId: new FormControl<number | null>(null),
      businessUnitId: new FormControl<number | null>(null),
      fornitoreId: new FormControl<string | null>(null),
      apprendiKeyword: new FormControl<boolean>(true, { nonNullable: true }),
      nota: new FormControl<string | null>(null),
    });
  }

  private buildEventoForm(): FormGroup<EventoForm> {
    return new FormGroup<EventoForm>({
      cogeId: new FormControl<number | null>(null),
      businessUnitId: new FormControl<number | null>(null),
      nota: new FormControl<string | null>(null),
    });
  }
}
