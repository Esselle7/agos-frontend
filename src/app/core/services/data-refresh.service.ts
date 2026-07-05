import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { CacheService } from './cache.service';

/**
 * Coordina il "ricarica i dati" sul frontend dopo una mutation backend.
 *
 * Pattern d'uso:
 *  1) L'interceptor `dataRefreshInterceptor` riconosce le POST/PUT/DELETE che
 *     impattano P&L / Cash Flow / dashboard (movimenti, pagamenti evento, rate
 *     ricorrenti) e chiama {@link notifyMutation}.
 *  2) {@link notifyMutation} invalida la cache lato FE (`dashboard:*`) e
 *     pubblica l'evento su {@link dashboardRefresh$}.
 *  3) I componenti dashboard / P&L si subscrivono a {@link dashboardRefresh$}
 *     e ri-fetchano dopo {@link refreshDelayMs} ms, lasciando il tempo al
 *     refresh asincrono delle MV backend di completare.
 *
 * Non è un meccanismo di polling: emette UNA volta per mutazione, non in loop.
 */
@Injectable({ providedIn: 'root' })
export class DataRefreshService {
  private readonly cache = inject(CacheService);

  /** Delay tra la mutation e il re-fetch, per dare tempo al backend di rinfrescare le MV. */
  readonly refreshDelayMs = 800;

  private readonly _dashboardRefresh = new Subject<void>();
  readonly dashboardRefresh$ = this._dashboardRefresh.asObservable();

  /**
   * Chiamato dall'interceptor (o manualmente) dopo una mutation andata a
   * buon fine che impatta dashboard / P&L / cash flow.
   */
  notifyMutation(): void {
    this.cache.invalidatePattern('dashboard:');
    // I saldi conti (mv_saldi_conti) cambiano ad ogni movimento finanziario: invalida anche
    // la cache dei conti così banca/cassa mostrano il saldo aggiornato dopo la mutation.
    this.cache.invalidate('conti:all');
    setTimeout(() => this._dashboardRefresh.next(), this.refreshDelayMs);
  }
}
