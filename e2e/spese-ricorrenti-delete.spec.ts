import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import { execSync } from 'child_process';
import * as path from 'path';

// ── Bypass login: stesso pattern di piano-conti.spec.ts ──────────────────────
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

const API = 'http://localhost:8080';
const MARKER = 'ZZ E2E DELETE';

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${mintAdminJwt()}`, 'Content-Type': 'application/json' };
}

/** Crea un piano FLAT marcato; ritorna id. */
async function apiCreatePlan(request: APIRequestContext, descrizione: string, importoRata = 11.00): Promise<string> {
  const coge = await (await request.get(`${API}/api/spese-ricorrenti/conti-coge`, { headers: authHeaders() })).json();
  const res = await request.post(`${API}/api/spese-ricorrenti/piani`, {
    headers: authHeaders(),
    data: {
      descrizione,
      contoBancarioId: 1,
      contoCoge: coge[0][0],
      importoRata,
      variazionePct: 0,
      giornoDelMese: 15,
      frequenza: 'MENSILE',
      numeroRate: 3,
      dataInizio: '2027-01-01',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

function cleanup(): void {
  // Hard-delete idempotente dei soli record marcati (movimenti generati inclusi).
  const sql =
    `DELETE FROM recurring_expense_plan WHERE descrizione LIKE '${MARKER}%'; ` +
    `DELETE FROM movimenti WHERE descrizione LIKE '${MARKER}%';`;
  execSync(`docker exec -e PGPASSWORD=agos agos-postgres psql -U agos -d agosdb -c "${sql}"`,
    { stdio: 'inherit' });
}

test.describe('Spese ricorrenti — eliminazione definitiva piano', () => {
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('dalla LISTA: bottone elimina → conferma → card sparita', async ({ page }) => {
    const desc = `${MARKER} lista`;
    const planId = await apiCreatePlan(page.request, desc);

    await page.goto('/spese-ricorrenti');
    await page.waitForLoadState('networkidle');

    const card = page.locator('.sr-card', { hasText: desc });
    await expect(card).toBeVisible();

    await card.locator('.sr-card__delete').click();
    // la card NON deve aver navigato al dettaglio (stopPropagation)
    await expect(page).toHaveURL(/\/spese-ricorrenti$/);

    const modal = page.locator('.sr-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('eliminati per sempre');

    await modal.getByRole('button', { name: /Elimina definitivamente/ }).click();
    await expect(card).toHaveCount(0);

    // il piano è davvero sparito lato server
    const gone = await page.request.get(`${API}/api/spese-ricorrenti/piani/${planId}`, { headers: authHeaders() });
    expect(gone.status()).toBe(404);
  });

  test('dal DETTAGLIO: bottone Elimina → conferma → redirect alla lista', async ({ page }) => {
    const desc = `${MARKER} dettaglio`;
    const planId = await apiCreatePlan(page.request, desc);

    await page.goto(`/spese-ricorrenti/${planId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Elimina', exact: true }).click();
    const modal = page.locator('.srd-modal');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: /Elimina definitivamente/ }).click();

    await expect(page).toHaveURL(/\/spese-ricorrenti$/);
    const gone = await page.request.get(`${API}/api/spese-ricorrenti/piani/${planId}`, { headers: authHeaders() });
    expect(gone.status()).toBe(404);
  });

  test('piano con rata PAGATA: nessun bottone elimina (lista e dettaglio)', async ({ page }) => {
    const desc = `${MARKER} pagato`;
    const planId = await apiCreatePlan(page.request, desc, 1.00); // 1€: minimizza il vincolo di saldo

    const detail = await (await page.request.get(
      `${API}/api/spese-ricorrenti/piani/${planId}`, { headers: authHeaders() })).json();
    const pay = await page.request.post(
      `${API}/api/spese-ricorrenti/piani/${planId}/rate/${detail.rate[0].id}/paga`,
      { headers: authHeaders(), data: {} });
    test.skip(pay.status() === 409, 'saldo conto 1 insufficiente nel DB dev: visibilità non verificabile');
    expect(pay.status()).toBe(200);

    await page.goto('/spese-ricorrenti');
    await page.waitForLoadState('networkidle');
    const card = page.locator('.sr-card', { hasText: desc });
    await expect(card).toBeVisible();
    await expect(card.locator('.sr-card__delete')).toHaveCount(0);

    await page.goto(`/spese-ricorrenti/${planId}`);
    await page.waitForLoadState('networkidle');
    // Liquida/Annulla presenti (piano ATTIVO), Elimina no
    await expect(page.getByRole('button', { name: /Liquida/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Elimina', exact: true })).toHaveCount(0);
  });
});
