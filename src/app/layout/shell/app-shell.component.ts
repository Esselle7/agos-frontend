import {
  Component,
  OnInit,
  DestroyRef,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs';
import { CommonModule } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/auth/auth.service';
import { BuService } from '../../core/services/bu.service';
import { ThemeService } from '../../core/services/theme.service';
import { BusinessUnitDTO } from '../../core/models/anagrafica.models';
import { ScadenzeImminentiDTO } from '../../core/models/dashboard.models';
import { API_PATHS } from '../../core/constants/api-paths';
import { environment } from '../../../environments/environment';

const SIDENAV_KEY = 'agos_sidenav_open';
const BU_KEY = 'agos_bu_expanded';
const NAV_OPEN_KEY = 'agos_nav_open_sections';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  adminOnly: boolean;
  /** Contatore opzionale stile "notifica non letta" (es. scadenze scadute). */
  badge?: () => number;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Navigazione raggruppata per area di lavoro (rotte invariate: nessun link rotto).
 * Quattro aree con confini netti — lavoro quotidiano → soldi → lettura → impostazioni:
 *   Operatività   = ciò che si apre ogni giorno (incluso Eventi, unica voce non-admin con Dashboard)
 *   Contabilità   = il registro dei soldi
 *   Analisi       = lettura/sola consultazione (report, previsioni, export)
 *   Configurazione = setup e dati di base, toccati di rado
 * Etichette in sentence case e nomi parlanti ("Regole di classificazione" al posto di
 * "Keyword", "Previsioni" al posto di "Forecasting", "Report" al posto di "Reporting").
 * Icone scelte tra quelle del font Material Icons classico in uso.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operatività',
    items: [
      { label: 'Dashboard',   icon: 'dashboard',      route: '/dashboard',   adminOnly: false },
      { label: 'Eventi',      icon: 'celebration',    route: '/eventi',      adminOnly: false },
      { label: 'Scadenzario', icon: 'event_upcoming', route: '/scadenzario', adminOnly: true },
    ],
  },
  {
    label: 'Contabilità',
    items: [
      { label: 'Movimenti',           icon: 'receipt_long',            route: '/movimenti',        adminOnly: true },
      { label: 'Import & smistamento', icon: 'move_to_inbox',           route: '/import',           adminOnly: true },
      // Cassa temporaneamente disabilitata (nascosta da nav + rotte); codice mantenuto.
      // { label: 'Cassa',               icon: 'account_balance_wallet',  route: '/cassa',            adminOnly: true },
      { label: 'Spese ricorrenti',    icon: 'event_repeat',            route: '/spese-ricorrenti', adminOnly: true },
      { label: 'Libro cespiti',       icon: 'inventory_2',             route: '/libro-cespiti',    adminOnly: true },
    ],
  },
  {
    label: 'Analisi',
    items: [
      { label: 'Report',       icon: 'assessment',  route: '/reporting',   adminOnly: true },
      { label: 'Previsioni',   icon: 'query_stats', route: '/forecasting', adminOnly: true },
      { label: 'Esporta dati', icon: 'ios_share',   route: '/export',      adminOnly: true },
    ],
  },
  {
    label: 'Configurazione',
    items: [
      { label: 'Anagrafica',                 icon: 'groups',       route: '/anagrafica',          adminOnly: true },
      { label: 'Piano dei conti',            icon: 'account_tree', route: '/piano-conti',         adminOnly: true },
      { label: 'Regole di classificazione',  icon: 'label',        route: '/keyword',             adminOnly: true },
      { label: 'Situazione iniziale',        icon: 'savings',      route: '/situazione-iniziale', adminOnly: true },
    ],
  },
];

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatBadgeModule,
    MatTooltipModule,
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly buService = inject(BuService);
  private readonly http = inject(HttpClient);
  private readonly themeService = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breakpoints = inject(BreakpointObserver);

  readonly user = this.authService.user;
  readonly isAdmin = this.authService.isAdmin;
  readonly isDarkTheme = this.themeService.theme;

  /** Sotto 768px la sidenav diventa overlay (mode="over"): niente rail che mangia spazio. */
  readonly isMobile = toSignal(
    this.breakpoints.observe('(max-width: 768px)').pipe(map(r => r.matches)),
    { initialValue: false },
  );

  /** Apertura dell'overlay su mobile (chiuso di default, nessuna persistenza). */
  readonly mobileNavOpen = signal(false);

  readonly sidenavOpen = signal<boolean>(
    sessionStorage.getItem(SIDENAV_KEY) !== 'false'
  );

  /** Barra "estesa" (label visibili): sempre su mobile, altrimenti segue sidenavOpen. */
  readonly expanded = computed(() => this.sidenavOpen() || this.isMobile());

  /** "Dettaglio BU": chiuso di default per non occupare spazio verticale (stato ricordato). */
  readonly buExpanded = signal<boolean>(
    sessionStorage.getItem(BU_KEY) === 'true'
  );

  /**
   * Sezioni della navbar aperte (accordion). Default: solo quella della rotta attiva, per
   * recuperare spazio verticale. Lo stato dell'utente persiste (localStorage) e la sezione
   * della pagina corrente viene comunque sempre riaperta a ogni navigazione.
   */
  readonly openSections = signal<Set<string>>(this.initOpenSections());

  readonly businessUnits = signal<BusinessUnitDTO[]>([]);
  readonly scadenzeCount = signal<number>(0);

  readonly visibleSections = computed<NavSection[]>(() =>
    NAV_SECTIONS
      .map(s => ({
        ...s,
        items: s.items
          .filter(i => !i.adminOnly || this.isAdmin())
          // Aggancia il contatore "scaduti" alla voce Scadenzario (badge stile notifica).
          .map(i => i.route === '/scadenzario' ? { ...i, badge: () => this.scadenzeCount() } : i),
      }))
      .filter(s => s.items.length > 0)
  );

  /** Iniziale per l'avatar del profilo (fallback '?' se il nome non è disponibile). */
  readonly userInitial = computed(() =>
    this.user()?.nome?.trim().charAt(0).toUpperCase() || '?'
  );

  readonly roleLabel = computed(() =>
    this.isAdmin() ? 'Amministratore' : 'Dipendente'
  );

  constructor() {
    effect(() => sessionStorage.setItem(SIDENAV_KEY, String(this.sidenavOpen())));
    effect(() => sessionStorage.setItem(BU_KEY, String(this.buExpanded())));
    effect(() =>
      localStorage.setItem(NAV_OPEN_KEY, JSON.stringify([...this.openSections()]))
    );

    // La sezione della pagina corrente resta sempre visibile: la riapre a ogni navigazione.
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(e => {
        if (this.isMobile()) this.mobileNavOpen.set(false);
        const label = this.sectionForUrl((e as NavigationEnd).urlAfterRedirects);
        if (label) this.openSections.update(s => new Set(s).add(label));
      });
  }

  ngOnInit(): void {
    this.buService.getAll().subscribe(units => this.businessUnits.set(units));
    if (this.isAdmin()) {
      this.loadScadenze();
    }
  }

  // ── Sezioni navbar collassabili ─────────────────────────────────────────────

  private initOpenSections(): Set<string> {
    const saved = localStorage.getItem(NAV_OPEN_KEY);
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) return new Set<string>(arr);
      } catch { /* stato corrotto → fallback sotto */ }
    }
    const active = this.sectionForUrl(window.location.pathname);
    return new Set<string>([active ?? NAV_SECTIONS[0].label]);
  }

  /** Etichetta della sezione che contiene la rotta data (match più specifico). */
  private sectionForUrl(url: string): string | null {
    let best: { label: string; len: number } | null = null;
    for (const s of NAV_SECTIONS) {
      for (const it of s.items) {
        if (url === it.route || url.startsWith(it.route + '/')) {
          if (!best || it.route.length > best.len) best = { label: s.label, len: it.route.length };
        }
      }
    }
    return best?.label ?? null;
  }

  isSectionOpen(label: string): boolean {
    return this.openSections().has(label);
  }

  toggleSection(label: string): void {
    this.openSections.update(s => {
      const next = new Set(s);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  /** Tooltip della voce (barra compressa): aggiunge il conteggio scaduti se presente. */
  navTooltip(item: NavItem): string {
    const n = item.badge?.() ?? 0;
    return n > 0 ? `${item.label} · ${n} scadute` : item.label;
  }

  toggleSidenav(): void {
    if (this.isMobile()) this.mobileNavOpen.update(v => !v);
    else this.sidenavOpen.update(v => !v);
  }

  toggleBu(): void {
    this.buExpanded.update(v => !v);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  logout(): void {
    this.authService.logout();
  }

  /**
   * Conta le scadenze GIÀ SCADUTE (non semplicemente urgenti): è il numero mostrato come
   * "notifica non letta" accanto a Scadenzario. Usa un periodo ampio (YTD) per non perdere
   * scaduti fuori dal mese corrente. Scaduto = scadenza passata e ancora non saldato/incassato.
   */
  private loadScadenze(): void {
    const oggi = new Date().toISOString().slice(0, 10);
    this.http
      .get<ScadenzeImminentiDTO>(
        environment.apiBaseUrl + API_PATHS.DASHBOARD.SCADENZE_IMMINENTI,
        { params: { period: 'YTD' } }
      )
      .subscribe({
        next: data => {
          const movScaduti = [
            ...(data.usciteDaLiquidare ?? []),
            ...(data.entrateDaRicevere ?? []),
          ].filter(m => m.ggAllaScadenza < 0).length;
          const eventiRateScaduti = [...data.eventi, ...data.rateRicorrenti]
            .filter(s => s.stato !== 'PAID' && s.dataScadenza < oggi).length;
          this.scadenzeCount.set(movScaduti + eventiRateScaduti);
        },
        error: () => {},
      });
  }
}
