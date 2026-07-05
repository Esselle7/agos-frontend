import {
  HttpEventType,
  HttpInterceptorFn,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs/operators';
import { DataRefreshService } from './data-refresh.service';
import { environment } from '../../../environments/environment';

/**
 * Riconosce le scritture HTTP che impattano P&L / cash flow / dashboard e
 * notifica {@link DataRefreshService} dopo che il backend ha risposto con
 * successo (2xx). Non altera la richiesta né la risposta.
 *
 * Path coperti:
 *   - /api/movimenti (POST / PUT / DELETE)
 *   - /api/eventi/{id}/pagamenti (POST)
 *   - /api/spese-ricorrenti/piani (POST / PUT / DELETE su rate, piano,
 *     /paga, /skip, /liquida, /annulla)
 *
 * Vengono ignorati i GET (sono read-only) e gli endpoint di autenticazione.
 */
export const dataRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  const isMutation = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (!isMutation || !shouldTrigger(req.url)) {
    return next(req);
  }

  const refresh = inject(DataRefreshService);

  return next(req).pipe(
    tap(event => {
      if (event.type === HttpEventType.Response) {
        const resp = event as HttpResponse<unknown>;
        if (resp.status >= 200 && resp.status < 300) {
          refresh.notifyMutation();
        }
      }
    })
  );
};

function shouldTrigger(url: string): boolean {
  if (!url.startsWith(environment.apiBaseUrl)) return false;
  // Endpoint che modificano dati P&L / CF / dashboard
  return (
    url.includes('/api/movimenti') ||
    url.includes('/api/eventi/') && url.includes('/pagamenti') ||
    url.includes('/api/spese-ricorrenti/piani') ||
    // Acquisto cespite: genera un'uscita CAPEX → impatta cassa/dashboard/P&L
    url.includes('/api/cespiti/acquisto') ||
    // Liquidazione differita di un acquisto cespite: paga l'uscita → impatta cassa/dashboard
    (url.includes('/api/cespiti/') && url.includes('/liquidazione'))
  );
}
