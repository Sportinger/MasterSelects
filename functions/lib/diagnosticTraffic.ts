/** Recognizable automation only; an unmatched agent is not proof of a human.
 * Keep these reports in D1, but separate them from product failure aggregates.
 * Use the server-observed user agent, not client-supplied diagnostic context.
 */
export const automatedDiagnosticTrafficSql = `(
  lower(COALESCE(user_agent, '')) LIKE '%bot%'
  OR lower(COALESCE(user_agent, '')) LIKE '%spider%'
  OR lower(COALESCE(user_agent, '')) LIKE '%crawler%'
  OR lower(COALESCE(user_agent, '')) LIKE '%headlesschrome%'
  OR lower(COALESCE(user_agent, '')) LIKE '%meta-external%'
  OR lower(COALESCE(user_agent, '')) LIKE '%meta-webindexer%'
)`;

export const nonAutomatedDiagnosticTrafficSql = `NOT ${automatedDiagnosticTrafficSql}`;

/** Report-only CSP observations are not runtime failures, including historic rows
 * that were stored with outcome=failed. Preserve the records for security audits.
 */
export const productFailureDiagnosticTrafficSql = `${nonAutomatedDiagnosticTrafficSql}
  AND NOT (COALESCE(component, '') = 'csp-report'
    AND COALESCE(json_extract(CASE WHEN json_valid(context_json) THEN context_json ELSE '{}' END, '$.disposition'), '') = 'report')`;
