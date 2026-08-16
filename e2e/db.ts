import { execSync } from 'child_process';

/**
 * Database su cui girano gli e2e (B5 della SPEC bonifica-doppioni-e-guardie-eventi).
 *
 * Non è `agosdb`: la suite scrive davvero — crea conti COGE, piani ricorrenti, movimenti, e
 * il test «salva il saldo iniziale della Cassa» riscrive `conti_bancari.data_saldo_iniziale`
 * con la data di oggi (situazione-iniziale.component.ts:275). Girando contro il DB di lavoro
 * ha lasciato 4 righe «ZZ Credito apertura E2E» e spostato al 14/08 la data di apertura della
 * Cassa (misurato il 14/08/2026, §B.2 punto 5).
 *
 * Override con `E2E_DB=... npm run e2e` se serve un altro nome.
 *
 * Le spec assumono dati realistici (storico import, movimenti, piano dei conti): un DB creato
 * solo da Flyway le fa fallire per assenza di dati, non per un difetto. Si rigenera da una copia
 * del DB di lavoro — misurato: con la copia, 4 dei 5 rossi da DB vergine spariscono.
 *
 *   docker exec -e PGPASSWORD=agos agos-postgres psql -U agos -d postgres \
 *     -c "DROP DATABASE agosdb_e2e" -c "CREATE DATABASE agosdb_e2e"
 *   docker exec -e PGPASSWORD=agos agos-postgres bash -c "pg_dump -U agos -d agosdb | psql -U agos -q -d agosdb_e2e"
 */
export const E2E_DB = process.env.E2E_DB ?? 'agosdb_e2e';

/** Il DB di lavoro: gli e2e non devono toccarlo mai. La guardia di global-setup lo difende. */
export const DB_DI_LAVORO = 'agosdb';

/** Esegue SQL sul DB e2e via psql nel container Postgres. */
export function psql(sql: string, stdio: 'ignore' | 'inherit' = 'ignore'): void {
  execSync(`docker exec -e PGPASSWORD=agos agos-postgres psql -U agos -d ${E2E_DB} -c "${sql}"`, { stdio });
}
