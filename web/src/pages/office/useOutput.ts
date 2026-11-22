// Export / print of the office lists: shown only to roles with office.report.export / office.report.print,
// and logged in the database (office_log_export) before the file or print window is made.
// The database checks the same permission again, so hiding the buttons is not the only guard.
import { tell } from '../../components/ask'
import { useAuth } from '../../auth/AuthProvider'
import { ops, opsFriendly } from '../../lib/officeOps'

const notInstalled = (e: unknown) => /PGRST202|Could not find the function/i.test(String((e as { message?: string; code?: string })?.code ?? '') + ' ' + String((e as { message?: string })?.message ?? e))

export function useOfficeOutput(list: string) {
  const { can } = useAuth()
  return {
    canExport: can('office.report.export'), canPrint: can('office.report.print'),
    beforeOutput: async (format: 'excel' | 'pdf' | 'print', rows: number) => {
      try { await ops.logExport(list, format, rows); return true }
      catch (e) { if (notInstalled(e)) return true; void tell(opsFriendly(e)); return false }
    },
  }
}
