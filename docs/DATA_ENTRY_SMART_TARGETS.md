# XZM TEAM · Explainable Smart Daily Target Engine

The smart mode is the default algorithm when a zonal manager enables automatic distribution for a hub. The branch contains no live rollout and adds no automatic role grants. The Team page reuses the Phase 1 zone-management permission. The authenticated Staff panel reads only the signed-in employee's own rows and aggregated hub figures.

| Input | Source and decision |
| --- | --- |
| Forecast | Asia/Dhaka dates D−7 through D−1. Use approved, non-voided pickup consolidations. Missing dates are displayed and excluded from the mean. With no observed day, the forecast is unavailable. The pickup source has no explicit verified zero-day record. |
| Today's actual pickups | Approved consolidations for D. A later approve or void is picked up by the one-minute refresh. Actual totals and forecast totals are independent. |
| Eligibility | Active Data Entry membership and employee, assigned to the hub. Approved leave (both existing workflows) takes precedence, then submitted morning attendance at the employee's HR hub, then HR attendance. Pending, absent, leave and off days receive no new work. A half day halves the configured gross shift. |
| Available time | Approved gross shift minus configured break and approved senior, loading, big parcel, training and other duty minutes. Remaining actual time also deducts verified minutes already worked. Share the resulting time equally among the worker's enabled assigned hubs so the same minutes are counted once. |
| Hourly rates | Last 28 completed Asia/Dhaka dates. Require at least 3 distinct dates and 180 verified entry minutes per unit. Use correct parcels÷hours for parcel rate. Use attempted Work Points × verified accuracy÷hours for the weighted rate. Use zonal-approved starting rates when the sample is insufficient. Exclude records without merchant or complexity values from the Work Points rate sample. |
| Work Points | Default weights are one point per parcel, five per distinct merchant, and two extra per approved complex parcel. The actual allocation uses the observed merchant mix. When complexity is unknown, omit its surcharge and show that input as missing. The forecast uses parcel rates because today's mix is unconfirmed. |
| Allocation | Convert the hub's weighted workload to whole parcel equivalents. Cap total assignable work by team capacity in the current unit, split proportionally by adjusted capacity, and reconcile whole counts with largest remainder. Show overflow as unassigned. When recalculating actual work, retain the verified completion total and split only what remains. Actual results are batch quotas based on the hub's mix. Item-level or merchant-level queue assignment is a separate integration. |
| Performance | Zonal-approved referral count, reporting, teamwork and contribution have their own profile and audit trail. They do not enter the target formula. |

Team managers use the Smart Work Distribution section to approve shift/rates, daily duty and verified work summaries, complexity, and performance entries. A verified work summary is the full total per staff member, hub and date, not an incremental import. The earlier full Data Entry report/approval module has not landed. These approved summaries supply the engine until it is connected to that module.

The one-tap employee report exposes the seven dates, source rates, each duty deduction, assigned hubs, both capacity calculations, actual and forecast targets, and revision history in Bangla and English. Admin inputs use the existing audit log. Calculation snapshots are append-only; unchanged retries return without a revision.

## Checks and rollout

- The repository database CI runs an isolated DEMO fixture with four workers and a 500-parcel forecast, then 800 approved actual parcels, attendance, leave, duties, verified rates, overflow, role scope and retry history.
- Before enabling the module for a real hub, verify staging has the base schema, pg_cron and the job named `data-entry-smart-targets`, confirm current app role scope, and run the signed-in Web and Android checks with the DEMO accounts.
- Pickups are never changed by the engine. To pause assignment, disable the hub in Team settings. Retain immutable target revisions. To roll back the app, restore the previous Web and Android releases. Remove the cron job only in an approved migration if retiring the engine entirely.
- Confirm the provisional Work Points weights, 28-day sample requirements and equal split across enabled assigned hubs before enabling production.
