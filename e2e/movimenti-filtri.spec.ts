// Filtri avanzati movimenti — docs/specs/movimenti-filtri-avanzati.md
//
// NOTA sul rate limit: il backend in profilo dev applica RateLimitFilter a 100 richieste/minuto
// (solo %test lo alza a 10000). Ogni test qui carica la pagina intera, che da sola vale una
// decina di chiamate: lanciare la suite con --repeat-each finisce per sfondare la soglia e i
// test falliscono con la lista vuota per HTTP 429, non per un difetto dell'interfaccia.
// Girala come previsto — `npm run e2e`, una passata.
import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import * as path from 'path';

// ── Bypass login: stesso pattern di piano-conti.spec.ts ──────────────────────
const USER_ID = '742bb26e-49f6-44ec-84a4-4fa92517bdd8'; // Simone, ADMIN (seed V4)
const EMAIL = 'simone.leone300900@gmail.com';
const PRIVATE_KEY = path.resolve(__dirname, '../../agos-backend/src/main/resources/privateKey.pem');
const API = 'http://localhost:8080';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function mintAdminJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: 'https://agostinelli.gestionale',
    sub: USER_ID, upn: EMAIL, email: EMAIL, role: 'ADMIN', groups: ['ADMIN'],
    iat: now, exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign('RSA-SHA256').update(signingInput).sign(readFileSync(PRIVATE_KEY));
  return `${signingInput}.${b64url(sig)}`;
}

async function loginAs(page: Page): Promise<void> {
  const token = mintAdminJwt();
  const user = JSON.stringify({ id: USER_ID, email: EMAIL, nome: 'Simone', ruolo: 'ADMIN', personaleId: null });
  const exp = String(Date.now() + 3600_000);
  await page.addInitScript(([t, u, e]) => {
    sessionStorage.setItem('auth_access_token', t);
    sessionStorage.setItem('auth_refresh_token', t);
    sessionStorage.setItem('auth_user', u);
    sessionStorage.setItem('auth_expires_at', e);
  }, [token, user, exp] as [string, string, string]);
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${mintAdminJwt()}` };
}

async function apriPannello(page: Page) {
  await page.getByRole('button', { name: /^Filtri/ }).click();
  await expect(page.getByRole('dialog', { name: 'Filtri' })).toBeVisible();
}

/**
 * Preme «Applica» e attende che il pannello si chiuda: è l'unico segnale di stato che il
 * componente controlla direttamente. I valori a valle si leggono con asserzioni auto-ritentate
 * (`expect`/`expect.poll`), non con letture secche — leggere subito dopo il clic significa
 * fotografare i totali della query precedente.
 */
async function applica(page: Page) {
  await page.getByRole('dialog', { name: 'Filtri' })
    .getByRole('button', { name: /^Applica/ }).click();
  await expect(page.getByRole('dialog', { name: 'Filtri' })).toBeHidden();
}

/** Numero di movimenti dichiarato dall'intestazione della lista. */
async function totale(page: Page): Promise<number> {
  const txt = await page.locator('.mov-list__count').textContent();
  return Number(txt!.replace(/\D/g, ''));
}

test.describe('Movimenti — filtri avanzati', () => {

  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await page.goto('/movimenti');
    await expect(page.getByRole('heading', { name: 'Movimenti' })).toBeVisible();
    // Il conteggio compare solo a lista caricata: è il segnale che i dati ci sono.
    await expect(page.locator('.mov-list__count')).toBeVisible();
  });

  test('il pannello si apre, filtra per conto e lascia una chip rimovibile', async ({ page }) => {
    await apriPannello(page);

    // Sezione Conto: seleziono il primo conto disponibile
    const panel = page.getByRole('dialog', { name: 'Filtri' });
    const primoConto = panel.locator('.mfp__chip').first();
    const nomeConto = (await primoConto.textContent())!.trim();
    await primoConto.click();
    await expect(primoConto).toHaveAttribute('aria-pressed', 'true');

    await applica(page);

    // La chip compare e il badge conta 1
    await expect(page.locator('.mov-chips__item')).toHaveCount(1);
    await expect(page.locator('.mov-chips__item')).toContainText(nomeConto);
    await expect(page.locator('.mov-list__filter-badge')).toHaveText('1');

    // Rimuovendo la chip il filtro sparisce
    await page.locator('.mov-chips__item').click();
    await expect(page.locator('.mov-chips')).toHaveCount(0);
    await expect(page.locator('.mov-list__filter-badge')).toHaveCount(0);
  });

  test('«Senza banca» filtra i movimenti non attribuiti e concorda con l\'API', async ({ page, request }) => {
    // Verità: quanti movimenti senza banca dice il backend
    const res = await request.get(`${API}/api/movimenti/senza-banca`, { headers: authHeaders() });
    expect(res.ok()).toBeTruthy();
    const attesi = (await res.json()).length;

    await apriPannello(page);
    const panel = page.getByRole('dialog', { name: 'Filtri' });
    await panel.getByRole('button', { name: 'Senza banca' }).click();
    await applica(page);

    await expect(page.locator('.mov-chips__item')).toContainText('Senza banca');
    await expect(page.locator('.mov-list__count')).toHaveText(`${attesi} totali`);
  });

  test('il selettore data cambia davvero campo e il sommario segue la lista', async ({ page }) => {
    await apriPannello(page);
    const panel = page.getByRole('dialog', { name: 'Filtri' });

    // Scelgo "Data finanziaria" e un periodo
    await panel.getByRole('radio', { name: 'Data finanziaria' }).click();
    await expect(panel.getByRole('radio', { name: 'Data finanziaria' })).toHaveAttribute('aria-checked', 'true');
    await expect(panel.locator('.mfp__hint').first()).toContainText('vista della cassa');

    // I datepicker usano l'adapter nativo senza locale italiano: il formato accettato è M/G/AAAA.
    await panel.getByRole('textbox', { name: 'Dal', exact: true }).fill('1/1/2026');
    await panel.getByRole('textbox', { name: 'Al', exact: true }).fill('6/30/2026');
    await applica(page);

    // La chip dichiara SU QUALE data sta filtrando: senza questo il numero è ambiguo
    const chipPeriodo = page.locator('.mov-chips__item', { hasText: 'Data finanziaria' });
    await expect(chipPeriodo).toContainText('01/01/2026 – 30/06/2026');

    // Lista e riepilogo devono parlare dello stesso insieme (invariante di spec)
    await expect.poll(async () => {
      const nLista = await totale(page);
      const nSommario = Number((await page.locator('.mov-summary__count').textContent())!.replace(/\D/g, ''));
      return nSommario === nLista;
    }).toBe(true);
  });

  test('più valori nella stessa dimensione vanno in OR e allargano il risultato', async ({ page }) => {
    await apriPannello(page);
    const panel = page.getByRole('dialog', { name: 'Filtri' });

    const totaleGenerale = await totale(page);

    await panel.getByRole('button', { name: 'Entrate' }).click();
    await applica(page);
    await expect(page.locator('.mov-chips__item')).toHaveCount(1);
    await expect.poll(() => totale(page)).toBeLessThan(totaleGenerale);
    const soloEntrate = await totale(page);

    await apriPannello(page);
    await panel.getByRole('button', { name: 'Uscite' }).click();
    await applica(page);
    await expect(page.locator('.mov-chips__item')).toHaveCount(2);

    // Entrate OR Uscite = tutto: due valori nella stessa dimensione allargano, non restringono.
    await expect.poll(() => totale(page)).toBeGreaterThan(soloEntrate);
  });

  test('la ricerca del piano dei conti restringe le opzioni', async ({ page }) => {
    await apriPannello(page);
    const panel = page.getByRole('dialog', { name: 'Filtri' });
    const tendinaConti = panel.getByRole('combobox', { name: 'Conti selezionati' });

    await tendinaConti.click();
    const totaleOpzioni = await page.locator('mat-option').count();
    expect(totaleOpzioni).toBeGreaterThan(10);
    await page.keyboard.press('Escape');
    await expect(page.locator('mat-option')).toHaveCount(0);

    await panel.getByRole('textbox', { name: 'Cerca conto' }).fill('49.99');
    await tendinaConti.click();
    const opzioniFiltrate = await page.locator('mat-option').count();
    expect(opzioniFiltrate).toBeLessThan(totaleOpzioni);
    expect(opzioniFiltrate).toBeGreaterThan(0);
  });

  /**
   * Regressione: filtrando SUBITO, mentre il caricamento iniziale è ancora in volo, la risposta
   * non filtrata può atterrare dopo quella filtrata e sovrascriverla. Il sintomo era una lista
   * con tutti i movimenti sotto una chip «Uscite», riepilogo con entrate incluse.
   * Fallirebbe di nuovo se si togliesse lo switchMap in MovimentiListComponent.
   */
  test('un filtro applicato durante il caricamento iniziale non viene sovrascritto', async ({ page }) => {
    await page.goto('/movimenti');
    // niente attesa: si corre di proposito contro la richiesta iniziale
    await page.getByRole('button', { name: /^Filtri/ }).click();
    const panel = page.getByRole('dialog', { name: 'Filtri' });
    await panel.getByRole('button', { name: 'Uscite' }).click();
    await applica(page);

    await expect(page.locator('.mov-chips__item')).toContainText('Uscite');

    // Con sole uscite il riepilogo non può contenere entrate: se le contiene, ha vinto
    // la risposta non filtrata e i dati non corrispondono ai filtri dichiarati.
    await expect.poll(async () => {
      const testi = await page.locator('.mov-summary__entrata').allTextContents();
      return testi.every(t => /^\+0,00/.test(t.trim()));
    }, { timeout: 10_000 }).toBe(true);
  });

  test('«Azzera tutto» riporta la lista allo stato non filtrato', async ({ page }) => {
    const totaleIniziale = await totale(page);

    await apriPannello(page);
    const panel = page.getByRole('dialog', { name: 'Filtri' });
    await panel.getByRole('button', { name: 'Uscite' }).click();
    await applica(page);
    await expect(page.locator('.mov-chips__item')).toHaveCount(1);
    await expect.poll(() => totale(page)).toBeLessThan(totaleIniziale);

    await page.getByRole('button', { name: 'Azzera tutto' }).click();
    await expect(page.locator('.mov-chips')).toHaveCount(0);
    await expect(page.locator('.mov-list__count')).toHaveText(`${totaleIniziale} totali`);
  });
});
