# Attendance integration review

This candidate includes PR #152 through the daily/monthly register changes,
the scoped Workforce Hub overview from #150, and the owner's cutoff rules.
The alternative #151 migrations must not be applied alongside this candidate.

- The morning workflow and route publication use the existing frontend RPCs.
- Zonal managers set morning and daily deadlines through the zone policy.
  Deadlines use Asia/Dhaka. Daily automation starts when day_time or day_extra
  is explicitly saved, and applies from that work date forward.
- Blank and incomplete forms remain open for review. The hub and zonal
  managers get one inbox reminder per form, hub and work date. The job can
  submit after the saved draft is complete. Historical edits still require
  the existing zonal reopening workflow.
- Daily submissions carry numbered versions. Monthly submissions reference
  their daily versions. A missing daily version prevents the monthly submission.
  Corrections retain older monthly versions and trigger resubmission. Review
  belongs to an exact daily or monthly version.
- Verify hosted scheduling, push and real-role end-to-end access separately.
