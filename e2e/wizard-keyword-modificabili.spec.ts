import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import * as path from 'path';

/**
 * Le keyword si possono accorciare PRIMA che il sistema le impari
 * (SPEC `docs/specs/keyword-modificabili-prima-apprendimento.md`, verifica 6).
 *
 * Che cosa fallirebbe se la feature si rompesse: i chip smettono di spegnersi, la frase che
 * avverte dell'allargamento sparisce, oppure — il caso peggiore — la conferma manda al server la
 * firma intera mentre a schermo l'operatore ne aveva spenta metà. Quest'ultimo è il motivo per
 * cui il test guarda il **payload**, non il DOM: un chip barrato che non cambia ciò che si scrive
 * è esattamente il placebo che la SPEC vuole impedire.
 *
 * ⚠️ Tutte le chiamate sono intercettate: questa spec non tocca nessun database. La guardia di
 * `global-setup` resta quella che difende `agosdb` per il resto della suite; qui in più c'è un
 * catch-all che ABORTA qualunque scrittura non prevista, così una regressione che aggiungesse una
 * chiamata la fa vedere invece di lasciarla arrivare a un DB vero.
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

const COGE_ID = 901;
const RIGA = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  tipo: 'USCITA', importo: 120.0, dataMovimento: '2026-07-15',
  descrizione: 'PAGAMENTO A FAVORE DI SMART WASH ALBAIRA SRL',
  cogeCodiceAttuale: '49.99.999',
  fornitoreId: null, contoBancarioId: 1,
  ibanEstratto: null, controparteEstratta: 'SMART WASH ALBAIRA SRL',
  gruppo: 'SMART WASH ALBAIRA', dataOperazione: null, circuitoPos: null, riscontroBilly: null,
  cogeSuggeritoId: COGE_ID, motivoSuggerimento: 'firma keyword già vista',
  buSuggerita: 2, fornitoreNome: null, riferimentoEsterno: 'RIF-1', metodoPagamento: 'BONIFICO',
  // La firma lunga del caso misurato: la terza sede del fornitore ne farebbe nascere una terza.
  firmeDaImparare: [{ token: ['SMART', 'WASH', 'ALBAIRA'], natura: 'IDENTITA' }],
};

/** Il corpo dell'unica PUT che questa spec si aspetta. Riempito dall'intercettore. */
let inviato: any = null;

test.beforeEach(async ({ page }) => {
  inviato = null;
  const token = mintAdminJwt();
  const user = JSON.stringify({ id: USER_ID, email: EMAIL, nome: 'Simone', ruolo: 'ADMIN', personaleId: null });
  await page.addInitScript(([t, u, e]) => {
    sessionStorage.setItem('auth_access_token', t);
    sessionStorage.setItem('auth_refresh_token', t);
    sessionStorage.setItem('auth_user', u);
    sessionStorage.setItem('auth_expires_at', e);
  }, [token, user, String(Date.now() + 3600_000)] as [string, string, string]);

  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  // ⚠️ L'ordine conta: Playwright fa vincere la route registrata PER ULTIMA. Il catch-all va
  // messo per primo, altrimenti si mangia tutte le rotte specifiche (misurato: pagina vuota).
  // Rete di sicurezza: qualunque altro GET (badge, kpi, scadenze) → risposta vuota ma della forma
  // giusta; qualunque altra SCRITTURA è una regressione e va fatta vedere, non assecondata.
  await page.route(/\/api\//, async r => {
    if (r.request().method() !== 'GET') { await r.abort(); return; }
    await r.fulfill(json({ content: [], totalElements: 0, eventi: [], scadenze: [] }));
  });

  await page.route(/\/api\/movimenti\/import\/transitori(\?|$)/, r =>
    r.fulfill(json({ content: [RIGA], page: 0, size: 2000, totalElements: 1, totalPages: 1 })));
  await page.route(/\/api\/movimenti\/import\/bu-per-coge/, r => r.fulfill(json({ [COGE_ID]: [2] })));
  await page.route(/\/api\/piano-dei-conti/, r => r.fulfill(json(
    [{ id: COGE_ID, codice: '40.05.002', nome: 'Lavanderia', tipo: 'COSTO' }])));
  await page.route(/\/api\/bu$/, r => r.fulfill(json([{ id: 2, nome: 'Agriturismo' }, { id: 5, nome: 'Generale' }])));

  await page.route(/\/api\/movimenti\/import\/transitori\/[^/]+\/classifica/, async r => {
    inviato = r.request().postDataJSON();
    await r.fulfill({ status: 204, body: '' });
  });
});

test('i token spenti non finiscono nella firma, e la UI dice che così prende più righe', async ({ page }) => {
  await page.goto('/import/catalogare');
  // I chip vivono nel riquadro «ecco che cosa succede», che nasce solo dopo aver scelto il conto:
  // l'anteprima delle keyword è parte dell'effetto della conferma, non della domanda.
  await page.getByRole('button', { name: /Lavanderia/ }).first().click();

  const chip = (t: string) => page.getByRole('button', { name: t, exact: true });
  await expect(chip('SMART')).toBeVisible();
  await expect(chip('WASH')).toBeVisible();
  await expect(chip('ALBAIRA')).toBeVisible();

  // Finché non si tocca niente, l'avviso non c'è: non si spaventa chi non ha cambiato nulla.
  await expect(page.getByText('la firma diventa')).toHaveCount(0);

  // Via il comune: è il token che spacca in due la firma dello stesso fornitore.
  await chip('ALBAIRA').click();
  await expect(chip('ALBAIRA')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('la firma diventa')).toBeVisible();

  await page.getByRole('button', { name: 'Va bene' }).click();

  await expect.poll(() => inviato).not.toBeNull();
  // Il cuore del test: quello che si vede è quello che si manda.
  expect(inviato.firme).toEqual([{ token: ['SMART', 'WASH'] }]);
  // I1 — con le firme esplicite il flag storico non deve dire il contrario.
  expect(inviato.apprendiKeyword).toBe(false);
});

test('senza toccare i chip il percorso resta quello di prima: nessuna firma nel payload', async ({ page }) => {
  await page.goto('/import/catalogare');
  await page.getByRole('button', { name: /Lavanderia/ }).first().click();
  await expect(page.getByRole('button', { name: 'SMART', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Va bene' }).click();

  await expect.poll(() => inviato).not.toBeNull();
  expect(inviato.firme).toBeNull();
  expect(inviato.apprendiKeyword).toBe(true);
});

test('spegnendo tutto non si impara niente, e la UI lo dice', async ({ page }) => {
  await page.goto('/import/catalogare');
  await page.getByRole('button', { name: /Lavanderia/ }).first().click();
  for (const t of ['SMART', 'WASH', 'ALBAIRA']) {
    await page.getByRole('button', { name: t, exact: true }).click();
  }
  await expect(page.getByText('Hai spento tutto')).toBeVisible();

  await page.getByRole('button', { name: 'Va bene' }).click();

  await expect.poll(() => inviato).not.toBeNull();
  expect(inviato.firme).toEqual([]);
  expect(inviato.apprendiKeyword).toBe(false);
});
