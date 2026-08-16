import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import * as path from 'path';

/**
 * La barra di fase è l'UNICO elenco del lavoro (13/08/2026): il rail di sinistra è tornato a
 * essere solo strumenti.
 *
 * <p>Prima di questa data i due menu convivevano e non erano allineati — «Duplicati» e «Già a
 * libro» esistevano solo a sinistra, e chi lavorava sulla barra non le vedeva mai. Questa spec
 * fallisce se una coda torna a mancare dalla barra, o se il rail torna a duplicarle.
 *
 * <p>Il backend è stubbato: la spec verifica il MENU, non i numeri, e gira col solo `ng serve`.
 */
const USER_ID = '742bb26e-49f6-44ec-84a4-4fa92517bdd8';
const EMAIL = 'simone.leone300900@gmail.com';
const PRIVATE_KEY = path.resolve(__dirname, '../../agos-backend/src/main/resources/privateKey.pem');

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');
function mintAdminJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://agostinelli.gestionale',
    sub: USER_ID, upn: EMAIL, email: EMAIL, role: 'ADMIN', groups: ['ADMIN'],
    iat: now, exp: now + 3600,
  };
  const si = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  return `${si}.${b64url(createSign('RSA-SHA256').update(si).sign(readFileSync(PRIVATE_KEY)))}`;
}

const json = (body: unknown) =>
  ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test.beforeEach(async ({ page }) => {
  const token = mintAdminJwt();
  const user = JSON.stringify({ id: USER_ID, email: EMAIL, nome: 'Simone', ruolo: 'ADMIN', personaleId: null });
  await page.addInitScript(([t, u, e]) => {
    sessionStorage.setItem('auth_access_token', t);
    sessionStorage.setItem('auth_refresh_token', t);
    sessionStorage.setItem('auth_user', u);
    sessionStorage.setItem('auth_expires_at', e);
  }, [token, user, String(Date.now() + 3600_000)] as [string, string, string]);

  // Una coda per tipo con del lavoro dentro, «Già a libro» compresa: così la barra le mostra tutte.
  await page.route('**/api/movimenti/import/badge', r => r.fulfill(json({
    catalogare: 37, ricorrenti: 3, eventi: 26, matchingDifferiti: 2, scartati: 4,
    ultimoImportId: null,
  })));
  await page.route('**/api/movimenti/import/kpi', r => r.fulfill(json({
    righeTotali: 154, importate: 125, coperturaFornitoriPct: 80,
  })));
  await page.route('**/api/movimenti/import/transitori**', r => r.fulfill(json({
    content: [], page: 0, size: 2000, totalElements: 0, totalPages: 0,
  })));
});

test('la barra di fase porta TUTTE le code, Duplicati compresa', async ({ page }) => {
  await page.goto('/import/catalogare');

  const barra = page.locator('app-fasi-bar');
  await expect(barra).toBeVisible();

  // L'elenco completo del lavoro. «Fatto» chiude sempre la fila.
  const attese = ['Spese e ricavi', 'Incassi evento', 'Rate', 'Già a libro',
                  'Fuori dai conti', 'Duplicati', 'Fatto'];
  await expect(barra.locator('.fasi__label')).toHaveText(attese);

  // I numeri arrivano dal badge, in ordine di fase.
  await expect(barra.locator('li', { hasText: 'Spese e ricavi' })).toContainText('37 righe');
  await expect(barra.locator('li', { hasText: 'Incassi evento' })).toContainText('26 righe');
  await expect(barra.locator('li', { hasText: 'Rate' })).toContainText('3 righe');
  await expect(barra.locator('li', { hasText: 'Già a libro' })).toContainText('2 righe');
  await expect(barra.locator('li', { hasText: 'Fuori dai conti' })).toContainText('4 righe');

  // Duplicati non è nel badge (analisi O(n²)): finché nessuno apre la sezione il numero NON esiste,
  // e la barra deve dirlo invece di mostrare una spunta verde su un conteggio mai calcolato.
  const duplicati = barra.locator('li', { hasText: 'Duplicati' });
  await expect(duplicati, 'un conteggio mai misurato non può sembrare «fatto»').toContainText('da controllare');
  await expect(duplicati.locator('mat-icon')).toHaveCount(0);

  // Il rail di sinistra è tornato agli strumenti: nessuna coda duplicata, nessun titolo di gruppo.
  const rail = page.locator('.imp__nav');
  await expect(rail.locator('.imp__nav-label')).toHaveText(['Importa', 'Registro', 'Storico']);
  await expect(page.locator('.imp__nav-sep')).toHaveCount(0);
});

test('«Già a libro» sparisce dalla barra quando la sua coda è vuota', async ({ page }) => {
  await page.route('**/api/movimenti/import/badge', r => r.fulfill(json({
    catalogare: 1, ricorrenti: 0, eventi: 0, matchingDifferiti: 0, scartati: 0,
    ultimoImportId: null,
  })));

  await page.goto('/import/catalogare');
  const barra = page.locator('app-fasi-bar');
  await expect(barra.locator('.fasi__label')).toHaveText(
    ['Spese e ricavi', 'Incassi evento', 'Rate', 'Fuori dai conti', 'Duplicati', 'Fatto']);
  // La numerazione si richiude: niente buchi nella sequenza.
  await expect(barra.locator('.fasi__n')).toHaveText(['1', '2', '3', '4', '5', '6']);
});
