import { execSync } from 'child_process';
import { DB_DI_LAVORO, E2E_DB } from './db';

/**
 * Guardia fail-fast (B5): la suite non parte se il backend che sta per pilotare non è
 * agganciato al DB e2e.
 *
 * Serve perché gli e2e scrivono su qualunque database usi il backend di :8080 — non c'è
 * `webServer` nel config, il frontend punta a `http://localhost:8080` (environment.ts) e le
 * spec fanno psql per conto loro. Il danno è già successo una volta: saldo e
 * `data_saldo_iniziale` della Cassa riscritti su agosdb a ogni run.
 *
 * Come si avvia il backend giusto (misurato il 14/08/2026: la system property batte
 * `%dev.quarkus.datasource.jdbc.url`, e Flyway migra il DB e2e da solo):
 *
 *   ./mvnw quarkus:dev -Dquarkus.datasource.jdbc.url=jdbc:postgresql://localhost:5432/agosdb_e2e
 *
 * ponytail: il riconoscimento del backend passa da pg_stat_activity, non da un endpoint
 * diagnostico nuovo. Limite noto: un altro client JDBC aperto sul DB di lavoro (DBeaver, IntelliJ)
 * fa scattare la guardia lo stesso. Se dà fastidio, l'upgrade è un endpoint che restituisce
 * `current_database()` — non prima che serva davvero.
 */
export default function globalSetup(): void {
  if (connessioniJdbc(E2E_DB) === 0) {
    throw new Error(
      `[e2e] Nessun backend connesso a ${E2E_DB}. Gli e2e scrivono sul database del backend di :8080: `
      + `avvialo così → ./mvnw quarkus:dev -Dquarkus.datasource.jdbc.url=jdbc:postgresql://localhost:5432/${E2E_DB}`,
    );
  }
  if (connessioniJdbc(DB_DI_LAVORO) > 0) {
    throw new Error(
      `[e2e] C'è ancora un'applicazione connessa a ${DB_DI_LAVORO}. Se è il backend di :8080, la suite `
      + `riscriverebbe i dati di lavoro (saldi iniziali compresi): fermalo e riavvialo su ${E2E_DB}. `
      + `Se è solo un client SQL aperto, chiudilo.`,
    );
  }
}

function connessioniJdbc(db: string): number {
  const sql = `SELECT count(*) FROM pg_stat_activity WHERE datname='${db}' AND application_name='PostgreSQL JDBC Driver'`;
  const out = execSync(
    `docker exec -e PGPASSWORD=agos agos-postgres psql -U agos -d postgres -tAc "${sql}"`,
    { encoding: 'utf8' },
  );
  return Number(out.trim());
}
