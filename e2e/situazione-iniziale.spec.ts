import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import { execSync } from 'child_process';
import * as path from 'path';

// ── Bypass login: conia un JWT RS256 con la chiave dev del backend ────────────
// (stessi claim di JwtService.generateAccessToken: iss/sub/email/role/groups/exp)
const USER_ID = '742bb26e-49f6-44ec-84a4-4fa92517bdd8'; // Simone, ADMIN (seed V4)
const EMAIL = 'simone.leone300900@gmail.com';
const PRIVATE_KEY = path.resolve(__dirname, '../../agos-backend/src/main/resources/privateKey.pem');

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

const CESPITE_DESC = 'ZZ Forno E2E';
const CREDITO_DESC = 'ZZ Credito apertura E2E';

test.describe('Situazione iniziale', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    page.on('dialog', d => d.accept()); // confirm() di eliminazione cespite
    await page.goto('/situazione-iniziale');
    await expect(page.getByRole('heading', { name: 'Situazione iniziale' })).toBeVisible();
  });

  test('salva il saldo iniziale della Cassa', async ({ page }) => {
    const row = page.locator('.row', { hasText: 'Cassa' }).first();
    await expect(row).toBeVisible();
    await row.locator('input[type="number"]').fill('5000');
    await row.getByRole('button').click();
    await expect(row.getByText('Salvato')).toBeVisible({ timeout: 8000 });

    // ripristino: rimette 0 per non sporcare il dev
    await row.locator('input[type="number"]').fill('0');
    await row.getByRole('button').click();
    await expect(row.getByText('Salvato')).toBeVisible({ timeout: 8000 });
  });

  test('aggiunge un cespite, mostra ammortamento e totale, poi elimina', async ({ page }) => {
    await page.locator('.si__nav-item', { hasText: 'Cespiti' }).click();
    await page.getByRole('button', { name: 'Aggiungi cespite' }).click();

    const form = page.locator('.cform');
    await form.locator('input[type="text"]').fill(CESPITE_DESC);
    await form.locator('select').selectOption({ index: 1 }); // primo conto CAPEX 50.x
    const numbers = form.locator('input[type="number"]');
    await numbers.nth(0).fill('12000'); // costo
    await numbers.nth(1).fill('10');    // aliquota %
    await form.locator('input[type="date"]').fill('2024-06-01');

    // anteprima: 12000 * 10% / 12 = 100/mese
    await expect(form.locator('.cform__preview')).toContainText('100,00');
    await expect(form.locator('.cform__preview')).toContainText('anni'); // vita 10 anni

    await page.getByRole('button', { name: 'Salva cespite' }).click();

    // compare nella lista con ammortamento annuo 1.200 e nel totale
    // it-IT usa minimumGroupingDigits=2: 1200 → "1200,00" (senza punto), 12000 → "12.000,00"
    const cesp = page.locator('.cesp', { hasText: CESPITE_DESC });
    await expect(cesp).toBeVisible({ timeout: 8000 });
    await expect(cesp).toContainText('1200,00'); // ammortamento annuo
    await expect(page.locator('.cesp-foot')).toContainText('1200,00');

    // cleanup: elimina
    await cesp.locator('.ico--danger').click();
    await expect(page.locator('.cesp', { hasText: CESPITE_DESC })).toHaveCount(0, { timeout: 8000 });
  });

  test('crea una categoria investimento al volo e la usa per il cespite', async ({ page }) => {
    await page.locator('.si__nav-item', { hasText: 'Cespiti' }).click();
    await page.getByRole('button', { name: 'Aggiungi cespite' }).click();
    const form = page.locator('.cform');

    // crea categoria inline
    await form.getByRole('button', { name: '+ Aggiungi categoria' }).click();
    await form.locator('.newcat input').fill('ZZ E2E Categoria');
    await form.getByRole('button', { name: 'Crea' }).click();

    // la nuova categoria compare nel select ed è selezionata
    const opt = form.locator('select option', { hasText: 'ZZ E2E Categoria' });
    await expect(opt).toHaveCount(1, { timeout: 8000 });
    await expect(form.locator('select')).toHaveValue(await opt.getAttribute('value') ?? '');

    // completo e salvo il cespite sulla nuova categoria
    await form.locator('input[type="text"]').first().fill('ZZ Cespite con cat');
    const n = form.locator('input[type="number"]');
    await n.nth(0).fill('1000');
    await n.nth(1).fill('25');
    await form.locator('input[type="date"]').fill('2025-01-01');
    await page.getByRole('button', { name: 'Salva cespite' }).click();

    const cesp = page.locator('.cesp', { hasText: 'ZZ Cespite con cat' });
    await expect(cesp).toBeVisible({ timeout: 8000 });
    await expect(cesp).toContainText('ZZ E2E Categoria');

    await cesp.locator('.ico--danger').click();
    await expect(page.locator('.cesp', { hasText: 'ZZ Cespite con cat' })).toHaveCount(0, { timeout: 8000 });
  });

  // La data di apertura è la competenza economica delle partite: se accetta una data futura,
  // crediti e debiti nascono in un esercizio che non esiste ancora. Questa è la guardia.
  test('la data di apertura parte da oggi e rifiuta una data futura', async ({ page }) => {
    const dataInput = page.locator('.si__data input[type="date"]');
    const oggi = new Date();
    const oggiIso = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;

    await expect(dataInput).toHaveValue(oggiIso);
    await expect(page.locator('.si__data-hint')).toBeVisible();
    // il salvataggio dei saldi è abilitato con la data di default
    await expect(page.locator('.row .btn-save').first()).toBeEnabled();

    // data futura → errore visibile e salvataggio bloccato
    await dataInput.fill('2099-01-01');
    await expect(page.locator('.si__data-err')).toBeVisible();
    await expect(page.locator('.row .btn-save').first()).toBeDisabled();

    // e blocca anche l'aggiunta di una partita di apertura
    await page.locator('.si__nav-item', { hasText: 'Crediti da incassare' }).click();
    await page.getByRole('button', { name: 'Aggiungi credito' }).click();
    await page.locator('.cform input[type="text"]').first().fill('ZZ credito E2E');
    await page.locator('.cform input[type="number"]').first().fill('100');
    await expect(page.getByRole('button', { name: 'Aggiungi', exact: true })).toBeDisabled();
  });

  // Invariante documentata nel manuale: le partite di apertura NON gonfiano il conto economico
  // dell'esercizio in corso. Il P&L aggrega per MESE, quindi una competenza dentro il mese di
  // apertura ci finirebbe dentro: la competenza deve stare nell'anno precedente.
  test("un credito di apertura non entra nel P&L dell'esercizio in corso", async ({ page, request }) => {
    const token = mintAdminJwt();
    const auth = { Authorization: `Bearer ${token}` };
    const anno = new Date().getFullYear();
    const plRicavi = async () => {
      const r = await request.get(`http://localhost:8080/api/reporting/pl/tutte-bu?from=${anno}-01-01&to=${anno}-12-31`, { headers: auth });
      const d = await r.json();
      return (d.businessUnits as Array<{ ricavi: number }>).reduce((s, b) => s + b.ricavi, 0);
    };

    const prima = await plRicavi();

    await page.locator('.si__nav-item', { hasText: 'Crediti da incassare' }).click();
    await page.getByRole('button', { name: 'Aggiungi credito' }).click();
    const form = page.locator('.cform');
    await form.locator('input[type="text"]').first().fill(CREDITO_DESC);
    await form.locator('input[type="number"]').first().fill('1234');
    // coge-picker: il trigger apre un dialog (foglie + Conferma)
    await form.locator('button.cpk').click();
    await page.locator('.cp__leaf').first().click();
    await page.getByRole('button', { name: 'Conferma' }).click();
    await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
    await expect(page.locator('.row', { hasText: CREDITO_DESC })).toBeVisible({ timeout: 8000 });

    // (1) guardia DETERMINISTICA: la competenza dev'essere in un anno PRECEDENTE all'apertura.
    //     È il meccanismo che rende vera l'invariante; non dipende dal refresh delle MV.
    const lista = await (await request.get('http://localhost:8080/api/movimenti/partite-apertura?tipo=ENTRATA', { headers: auth })).json();
    const creato = (lista as Array<{ descrizione: string; dataCompetenza: string }>).find(m => m.descrizione === CREDITO_DESC);
    expect(creato, "il credito di apertura deve essere stato creato").toBeTruthy();
    expect(Number(creato!.dataCompetenza.slice(0, 4))).toBeLessThan(anno);

    // (2) controllo dell'ESITO: il P&L dell'anno in corso non si muove.
    //     Le MV si rinfrescano dopo il commit in modo asincrono → forzo il refresh, altrimenti
    //     leggerei un valore vecchio e il test passerebbe anche col bug (successo falso).
    execSync(`docker exec -e PGPASSWORD=agos agos-postgres psql -U agos -d agosdb -c "SELECT fn_refresh_all_mv()"`, { stdio: 'ignore' });
    expect(await plRicavi()).toBeCloseTo(prima, 2);

    await page.locator('.row', { hasText: CREDITO_DESC }).locator('.ico--danger').click();
    await expect(page.locator('.row', { hasText: CREDITO_DESC })).toHaveCount(0, { timeout: 8000 });
  });

  test('naviga le sezioni e apre il form crediti da incassare', async ({ page }) => {
    // hub: tutte le 6 sezioni nella nav
    for (const label of ['Liquidità', 'Cespiti', 'Crediti da incassare', 'Debiti da pagare', 'Finanziamenti', 'Rimanenze']) {
      await expect(page.locator('.si__nav-item', { hasText: label })).toHaveCount(1);
    }
    // sezione Crediti → apre il form con la categoria (coge-picker)
    await page.locator('.si__nav-item', { hasText: 'Crediti da incassare' }).click();
    await expect(page.getByRole('heading', { name: 'Crediti da incassare' })).toBeVisible();
    await page.getByRole('button', { name: 'Aggiungi credito' }).click();
    await expect(page.locator('.cform')).toBeVisible();
    await expect(page.getByText('Categoria ricavo')).toBeVisible();

    // sezione Finanziamenti → guida con link a Spese ricorrenti
    await page.locator('.si__nav-item', { hasText: 'Finanziamenti' }).click();
    await expect(page.locator('.guide__cta')).toContainText('Spese ricorrenti');
  });

  test.afterAll(() => {
    // la categoria creata è un conto COGE reale: pulizia diretta su DB
    execSync(`docker exec -e PGPASSWORD=agos agos-postgres psql -U agos -d agosdb -c "DELETE FROM piano_dei_conti_coge WHERE descrizione LIKE 'ZZ E2E%'"`,
      { stdio: 'ignore' });
  });
});
